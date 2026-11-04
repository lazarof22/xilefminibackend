import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Proveedor } from '../../clientes y provedores/proveedor/schema/proveedor.schema';
import { ConsecutivoService } from '../consecutivo/consecutivo.service';
import { ExistenciaService } from '../exitencia/existencia.service';
import { ResultadoMovimiento } from '../exitencia/existencia.types';
import { RegistroCompraService } from '../registro-compra/registro-compra.service';
import { EmpresaDatosService } from '../../configuracion/empresa-datos/empresa-datos.service';
import type { JwtUser } from '../../auth/types/jwt-user.type';
import {
  CreateRecepcionDto,
  LineaRecepcionDto,
} from './dto/create-recepcion.dto';
import { UpdateRecepcionDto } from './dto/update-recepcion.dto';
import {
  EstadoRecepcion,
  LineaRecepcion,
  Recepcion,
} from './schema/recepcion.schema';

/** Lo que ya quedó escrito de una línea mientras se registra el documento. */
interface LineaAplicada {
  linea: LineaRecepcion;
  movimiento: ResultadoMovimiento;
  registroId?: string;
  kardexId?: string;
}

const redondear = (valor: number): number =>
  Math.round((valor + Number.EPSILON) * 100) / 100;

/** "2026-10-05" se guarda a mediodía UTC para que no cambie de día según la zona horaria. */
const parseFecha = (fecha: string): Date =>
  /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? new Date(`${fecha}T12:00:00.000Z`)
    : new Date(fecha);

@Injectable()
export class RecepcionService {
  private readonly logger = new Logger(RecepcionService.name);

  constructor(
    @InjectModel(Recepcion.name)
    private readonly recepcionModel: Model<Recepcion>,
    @InjectModel(Producto.name)
    private readonly productoModel: Model<Producto>,
    @InjectModel(Almacen.name)
    private readonly almacenModel: Model<Almacen>,
    @InjectModel(Contenedor.name)
    private readonly contenedorModel: Model<Contenedor>,
    @InjectModel(Proveedor.name)
    private readonly proveedorModel: Model<Proveedor>,
    private readonly consecutivoService: ConsecutivoService,
    private readonly empresaDatosService: EmpresaDatosService,
    private readonly existenciaService: ExistenciaService,
    private readonly registroCompraService: RegistroCompraService,
  ) {}

  /** Crea el borrador: valida y calcula, pero NO mueve el saldo del inventario. */
  async crear(dto: CreateRecepcionDto, usuario: JwtUser): Promise<Recepcion> {
    await this.validarReferencias(
      dto.almacenReceptor,
      dto.proveedor,
      dto.lineas,
    );
    const entidadReceptora = await this.entidadReceptora();
    const lineas = this.calcularLineas(dto.lineas);
    const numeroConsecutivo = await this.consecutivoService.siguiente(
      'recepcion',
      'REC',
    );

    return this.recepcionModel.create({
      numeroConsecutivo,
      fechaEmision: dto.fechaEmision
        ? parseFecha(dto.fechaEmision)
        : new Date(),
      entidadReceptora,
      almacenReceptor: new Types.ObjectId(dto.almacenReceptor),
      proveedor: new Types.ObjectId(dto.proveedor),
      documentoOrigen: {
        tipo: dto.documentoOrigen.tipo,
        numero: dto.documentoOrigen.numero,
        fecha: parseFecha(dto.documentoOrigen.fecha),
      },
      transportista: dto.transportista,
      lineas,
      total: this.sumar(lineas),
      responsableRecepcion: usuario.nombre,
      responsableComprobacion: dto.responsableComprobacion,
    });
  }

  /** Edita un borrador. Una recepción registrada ya movió el saldo: no se modifica. */
  async actualizar(id: string, dto: UpdateRecepcionDto): Promise<Recepcion> {
    this.validarId(id);
    const actual = await this.buscar(id);
    if (actual.estado !== EstadoRecepcion.BORRADOR) {
      throw this.noEditable(actual);
    }

    const almacen = dto.almacenReceptor ?? String(actual.almacenReceptor);
    const proveedor = dto.proveedor ?? String(actual.proveedor);
    const lineasDto: LineaRecepcionDto[] =
      dto.lineas ??
      actual.lineas.map((l) => ({
        producto: String(l.producto),
        contenedor: String(l.contenedor),
        cantidad: l.cantidad,
        costo_unitario: l.costo_unitario,
      }));
    await this.validarReferencias(almacen, proveedor, lineasDto);

    const cambios: Record<string, unknown> = {};
    if (dto.fechaEmision) cambios.fechaEmision = parseFecha(dto.fechaEmision);
    if (dto.almacenReceptor) {
      cambios.almacenReceptor = new Types.ObjectId(dto.almacenReceptor);
    }
    if (dto.proveedor) cambios.proveedor = new Types.ObjectId(dto.proveedor);
    if (dto.documentoOrigen) {
      cambios.documentoOrigen = {
        tipo: dto.documentoOrigen.tipo,
        numero: dto.documentoOrigen.numero,
        fecha: parseFecha(dto.documentoOrigen.fecha),
      };
    }
    if (dto.transportista !== undefined)
      cambios.transportista = dto.transportista;
    if (dto.responsableComprobacion) {
      cambios.responsableComprobacion = dto.responsableComprobacion;
    }
    if (dto.lineas || dto.almacenReceptor) {
      const lineas = this.calcularLineas(lineasDto);
      cambios.lineas = lineas;
      cambios.total = this.sumar(lineas);
    }

    const actualizada = await this.recepcionModel
      .findOneAndUpdate(
        {
          _id: id,
          estado: EstadoRecepcion.BORRADOR,
          inventarioAplicado: { $ne: true },
        },
        { $set: cambios },
        { new: true, runValidators: true },
      )
      .lean()
      .exec();
    if (!actualizada) {
      // Se registró entre la lectura y la escritura.
      throw this.noEditable(await this.buscar(id));
    }
    return actualizada;
  }

  /**
   * Registra la recepción: mueve el saldo de cada línea al almacén receptor
   * y deja el kardex COMPRA con la referencia del documento y el importe.
   *
   * Idempotente: un reclamo condicional (`borrador` y sin `inventarioAplicado`)
   * fija `registrada` + `inventarioAplicado` en UNA escritura, así solo un
   * registro simultáneo gana y el saldo nunca se aplica dos veces. Si una
   * línea falla, se deshace lo ya escrito (stock, compra y kardex) y el
   * borrador vuelve a quedar editable; si ni así se puede deshacer, el
   * documento queda reclamado (para no aplicar dos veces) y se deja el log
   * con el detalle para corregir a mano.
   */
  async registrar(id: string, usuario: JwtUser): Promise<Recepcion> {
    this.validarId(id);
    const reclamada = await this.reclamar(id, usuario);
    const aplicadas: LineaAplicada[] = [];

    try {
      for (const linea of reclamada.lineas) {
        aplicadas.push(await this.aplicarLinea(reclamada, linea));
      }
    } catch (error) {
      const compensado = await this.compensar(reclamada, aplicadas);
      if (compensado) await this.liberarReclamo(reclamada);
      throw error;
    }
    return reclamada;
  }

  async findAll(
    filtro: { estado?: EstadoRecepcion } = {},
  ): Promise<Recepcion[]> {
    return this.recepcionModel
      .find(filtro.estado ? { estado: filtro.estado } : {})
      .sort({ fechaEmision: -1, createdAt: -1 })
      .lean()
      .exec();
  }

  async findOne(id: string): Promise<Recepcion> {
    this.validarId(id);
    return this.buscar(id);
  }

  // ── registrar: reclamo, aplicación y compensación ──────────────────

  private async reclamar(id: string, usuario: JwtUser): Promise<Recepcion> {
    const reclamada = await this.recepcionModel
      .findOneAndUpdate(
        {
          _id: id,
          estado: EstadoRecepcion.BORRADOR,
          inventarioAplicado: { $ne: true },
        },
        {
          $set: {
            estado: EstadoRecepcion.REGISTRADA,
            inventarioAplicado: true,
            fechaRegistro: new Date(),
            registradoPor: usuario.nombre,
          },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (reclamada) return reclamada;

    const existente = await this.buscar(id);
    throw new ConflictException(
      `La recepción ${existente.numeroConsecutivo} ya está registrada`,
    );
  }

  private async aplicarLinea(
    recepcion: Recepcion,
    linea: LineaRecepcion,
  ): Promise<LineaAplicada> {
    const almacenId = String(recepcion.almacenReceptor);
    const contenedorId = String(linea.contenedor);
    const movimiento = await this.existenciaService.reponerProducto({
      productoId: String(linea.producto),
      cantidad: linea.cantidad,
      almacenId,
      contenedorId,
    });
    const aplicada: LineaAplicada = { linea, movimiento };

    try {
      const { registro, kardexId } =
        await this.registroCompraService.registrarLinea(
          {
            producto: String(linea.producto),
            almacen: almacenId,
            contenedor: contenedorId,
            cantidad: linea.cantidad,
            costo_unitario: linea.costo_unitario,
            fecha: new Date(recepcion.fechaEmision).toISOString(),
          },
          {
            referencia: recepcion.numeroConsecutivo,
            motivo: `Recepción ${recepcion.numeroConsecutivo}`,
            importeCUP: linea.total,
          },
        );
      aplicada.registroId = String(
        (registro as unknown as { _id: unknown })._id,
      );
      aplicada.kardexId = kardexId;
      return aplicada;
    } catch (error) {
      // La línea con stock pero sin compra no llegó a la lista de aplicadas.
      await this.deshacerStock(recepcion, aplicada);
      throw error;
    }
  }

  /** Deshace, de la última a la primera, lo escrito. `true` si no quedó nada sin deshacer. */
  private async compensar(
    recepcion: Recepcion,
    aplicadas: LineaAplicada[],
  ): Promise<boolean> {
    let completo = true;
    for (const aplicada of [...aplicadas].reverse()) {
      try {
        if (aplicada.registroId) {
          await this.registroCompraService.descartarLinea({
            registroId: aplicada.registroId,
            kardexId: aplicada.kardexId,
          });
        }
        if (!(await this.deshacerStock(recepcion, aplicada))) completo = false;
      } catch (error) {
        completo = false;
        this.logger.error(
          `No se pudo deshacer la línea del producto ${String(aplicada.linea.producto)} de la recepción ${recepcion.numeroConsecutivo}, corregir a mano: ${String(error)}`,
        );
      }
    }
    return completo;
  }

  private async deshacerStock(
    recepcion: Recepcion,
    aplicada: LineaAplicada,
  ): Promise<boolean> {
    try {
      for (const u of aplicada.movimiento.ubicaciones) {
        await this.existenciaService.descontarProducto({
          productoId: String(aplicada.linea.producto),
          cantidad: u.cantidad,
          almacenId: String(u.almacen),
          contenedorId: String(u.contenedor),
        });
      }
      return true;
    } catch (error) {
      this.logger.error(
        `No se pudo devolver el stock del producto ${String(aplicada.linea.producto)} de la recepción ${recepcion.numeroConsecutivo}, corregir a mano: ${String(error)}`,
      );
      return false;
    }
  }

  /** Devuelve el documento a borrador tras deshacer todo. Nunca lanza. */
  private async liberarReclamo(recepcion: Recepcion): Promise<void> {
    try {
      const liberada = await this.recepcionModel
        .findOneAndUpdate(
          {
            _id: String((recepcion as Recepcion & { _id: Types.ObjectId })._id),
            estado: EstadoRecepcion.REGISTRADA,
            inventarioAplicado: true,
          },
          {
            $set: {
              estado: EstadoRecepcion.BORRADOR,
              inventarioAplicado: false,
            },
            $unset: { fechaRegistro: 1, registradoPor: 1 },
          },
          { new: true },
        )
        .lean()
        .exec();
      if (!liberada) {
        this.logger.error(
          `La recepción ${recepcion.numeroConsecutivo} quedó registrada sin saldo aplicado (no coincidió al liberarla), corregir a mano`,
        );
      }
    } catch (error) {
      this.logger.error(
        `No se pudo devolver la recepción ${recepcion.numeroConsecutivo} a borrador, corregir a mano: ${String(error)}`,
      );
    }
  }

  // ── validaciones y cálculo ─────────────────────────────────────────

  private validarId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('El ID de la recepción no es válido');
    }
  }

  private async buscar(id: string): Promise<Recepcion> {
    const recepcion = await this.recepcionModel.findById(id).lean().exec();
    if (!recepcion) {
      throw new NotFoundException('No se encontró la recepción');
    }
    return recepcion;
  }

  private noEditable(recepcion: Recepcion): ConflictException {
    return new ConflictException(
      `La recepción ${recepcion.numeroConsecutivo} ya está registrada y no se puede modificar`,
    );
  }

  private async entidadReceptora(): Promise<Recepcion['entidadReceptora']> {
    const empresa = await this.empresaDatosService.obtener();
    if (!empresa?.nombre) {
      throw new BadRequestException(
        'Configure los datos de la empresa antes de crear recepciones (entidad receptora)',
      );
    }
    return { codigo: empresa.ruc_nit ?? '', nombre: empresa.nombre };
  }

  private async validarReferencias(
    almacenId: string,
    proveedorId: string,
    lineas: LineaRecepcionDto[],
  ): Promise<void> {
    const [almacen, proveedor] = await Promise.all([
      this.almacenModel.findById(almacenId).select('_id').lean().exec(),
      this.proveedorModel.findById(proveedorId).select('_id').lean().exec(),
    ]);
    if (!almacen) throw new NotFoundException('El almacén receptor no existe');
    if (!proveedor) throw new NotFoundException('El proveedor no existe');

    for (const linea of lineas) {
      const [producto, contenedor] = await Promise.all([
        this.productoModel.findById(linea.producto).select('_id').lean().exec(),
        this.contenedorModel
          .findById(linea.contenedor)
          .select('almacen')
          .lean()
          .exec(),
      ]);
      if (!producto) throw new NotFoundException('El producto no existe');
      if (!contenedor) throw new NotFoundException('El contenedor no existe');
      if (String(contenedor.almacen) !== almacenId) {
        throw new BadRequestException(
          'El contenedor no pertenece al almacén receptor',
        );
      }
    }
  }

  private calcularLineas(lineas: LineaRecepcionDto[]): LineaRecepcion[] {
    return lineas.map((l) => ({
      producto: new Types.ObjectId(l.producto),
      contenedor: new Types.ObjectId(l.contenedor),
      cantidad: l.cantidad,
      costo_unitario: l.costo_unitario,
      total: redondear(l.cantidad * l.costo_unitario),
    }));
  }

  private sumar(lineas: LineaRecepcion[]): number {
    return redondear(lineas.reduce((suma, l) => suma + l.total, 0));
  }
}
