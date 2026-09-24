import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import { ListarFacturasQueryDto } from './dto/listar-facturas-query.dto';
import { Factura } from './schema/factura.schema';
import { FacturaContador } from './schema/factura-contador.schema';
import {
  Cliente,
  ClienteDocument,
} from '../clientes y provedores/cliente/schemas/cliente.schema';
import {
  Almacen,
  AlmacenDocument,
} from '../inventario/almacen/schema/almacen.schema';
import {
  Producto,
  ProductoDocument,
} from '../inventario/producto/schemas/producto.schema';
import { Pais } from '../nomencladores/pais/schema/pais.schema';
import { Usuario } from '../auth/schemas/empleado.schema';
import { EmpresaDatosService } from '../configuracion/empresa-datos/empresa-datos.service';
import {
  FACTURA_CAMPO_VACIO_SENTINEL,
  FACTURA_CLIENTE_DIRECCION_PLACEHOLDER,
  FACTURA_CLIENTE_EMAIL_PLACEHOLDER_DOMINIO,
  FACTURA_CLIENTE_NOMBRE_POR_DEFECTO,
  FACTURA_CLIENTE_TELEFONO_PLACEHOLDER_PREFIJO,
  FACTURA_CONTADOR_ID,
  FACTURA_LISTADO_LIMITE_DEFECTO,
  FACTURA_LISTADO_PAGINA_DEFECTO,
  FACTURA_TIMEZONE,
} from './factura.constants';
import { calcularTotales } from './factura-totales';
import { obtenerFechaEnZona, validarZonaHoraria } from './factura-fecha';
import { isDuplicateKeyError } from './factura-mongo-errors';

@Injectable()
export class FacturaService implements OnModuleInit {
  private readonly logger = new Logger(FacturaService.name);

  constructor(
    @InjectModel(Factura.name) private facturaModel: Model<Factura>,
    @InjectModel(FacturaContador.name)
    private facturaContadorModel: Model<FacturaContador>,
    @InjectModel(Cliente.name) private clienteModel: Model<Cliente>,
    @InjectModel(Almacen.name) private almacenModel: Model<Almacen>,
    @InjectModel(Producto.name) private productoModel: Model<Producto>,
    @InjectModel(Pais.name) private paisModel: Model<Pais>,
    @InjectModel(Usuario.name) private usuarioModel: Model<Usuario>,
    private readonly empresaDatosService: EmpresaDatosService,
  ) {}

  /**
   * Seeds the invoice counter from the highest existing `numero` so
   * previously imported invoices (created before this counter existed)
   * never collide with newly allocated numbers.
   */
  async onModuleInit(): Promise<void> {
    // Fail fast: an unrecognized FACTURA_TIMEZONE would otherwise only
    // surface as silently wrong invoice dates on every create().
    validarZonaHoraria(FACTURA_TIMEZONE);

    const ultima = await this.facturaModel
      .findOne()
      .sort({ numero: -1 })
      .exec();
    const maxNumero = ultima?.numero ?? 0;
    await this.facturaContadorModel
      .updateOne(
        { _id: FACTURA_CONTADOR_ID },
        { $max: { seq: maxNumero } },
        { upsert: true },
      )
      .exec();
  }

  /**
   * Runs every fallible step (almacén/productos, facturador, emisor,
   * client lookup, date, totals, and full document validation) BEFORE
   * allocating a correlative `numero`, so an invalid request never burns a
   * number. Only after the document validates does it allocate
   * `numero`/`id` and save; if `save()` still fails (e.g. a lost race on
   * the unique `numero` index), it attempts to release the allocated
   * number back to the counter (see `compensarNumeroTrasFalloDeGuardado`).
   *
   * `userId` is the authenticated JWT user id (T4, `FacturaController`),
   * never taken from the request body: it is resolved into `facturadoPor`
   * (name, CI, date) via `obtenerFacturadorPor`.
   */
  async create(
    createFacturaDto: CreateFacturaDto,
    userId: string,
  ): Promise<Factura> {
    const fecha =
      createFacturaDto.fecha ?? obtenerFechaEnZona(FACTURA_TIMEZONE);

    const limpiar = (v?: string) => {
      const t = (v ?? '').trim();
      return t === FACTURA_CAMPO_VACIO_SENTINEL ? '' : t;
    };

    const clienteNombre =
      limpiar(createFacturaDto.cliente) || FACTURA_CLIENTE_NOMBRE_POR_DEFECTO;
    const nit = limpiar(createFacturaDto.nit);
    const direccion = limpiar(createFacturaDto.direccion);
    const telefono = limpiar(createFacturaDto.telefono);
    const email = limpiar(createFacturaDto.email);

    const { items, subtotal, descuentoTotal, recargoTotal, impuesto, total } =
      calcularTotales(createFacturaDto.items, createFacturaDto.impuesto);

    // Both fallible (404/422/400) and run before siguienteNumero() (T9):
    // an invalid almacén or item never burns an invoice number.
    const almacen = await this.obtenerAlmacenValido(createFacturaDto.almacenId);
    await this.validarProductosDelAlmacen(items, createFacturaDto.almacenId);
    const facturadoPor = await this.obtenerFacturadorPor(userId);

    const emisor = await this.obtenerEmisor();

    let clienteId: Types.ObjectId | undefined;
    if (nit || telefono || email) {
      clienteId = (
        await this.buscarOCrearCliente({
          nombre: clienteNombre,
          nit,
          telefono,
          email,
          direccion,
        })
      )?._id;
    }

    const factura = new this.facturaModel({
      fecha,
      cliente: clienteNombre,
      nit,
      direccion,
      telefono,
      email,
      moneda: createFacturaDto.moneda ?? 'CUP',
      concepto: createFacturaDto.concepto,
      clienteId,
      almacenId: almacen._id,
      almacenCodigo: almacen.codigo,
      emisor,
      impuesto,
      metodoPago: createFacturaDto.metodoPago,
      items,
      subtotal,
      descuentoTotal,
      recargoTotal,
      total,
      estado: 'confirmada',
      tipo: createFacturaDto.tipo ?? 'factura_normal',
      impreso: createFacturaDto.impreso ?? false,
      despachadoPor: createFacturaDto.despachadoPor,
      transportadoPor: createFacturaDto.transportadoPor,
      recibidoPor: createFacturaDto.recibidoPor,
      facturadoPor,
    });

    // numero/id are not set yet (allocated below), so they are excluded
    // from this validation pass.
    await factura.validate({ pathsToSkip: ['numero', 'id'] });

    const numero = await this.siguienteNumero();
    factura.numero = numero;
    factura.id = this.generarId(numero);

    try {
      return await factura.save();
    } catch (err) {
      await this.compensarNumeroTrasFalloDeGuardado(numero, err);
      throw err;
    }
  }

  /**
   * After `save()` fails for an already-numbered invoice, tries to release
   * the allocated `numero` back to the counter so the next invoice can
   * reuse it. The conditional `{ seq: numero }` filter only matches (and
   * decrements) when no other invoice has allocated a later number since;
   * otherwise the number is permanently lost (a gap) and only logged.
   *
   * The number is never released when it is already taken: on a duplicate
   * key error, or when an invoice with that `numero` was actually persisted
   * (a write that applied server-side but reported an error). Releasing it
   * there would hand the same taken number to every next invoice, failing
   * each one until the counter is repaired by hand.
   */
  private async compensarNumeroTrasFalloDeGuardado(
    numero: number,
    err: unknown,
  ): Promise<void> {
    if (isDuplicateKeyError(err) || (await this.numeroPersistido(numero))) {
      this.logger.error(
        `El numero de factura ${numero} ya esta ocupado; no se libera y el contador sigue adelante tras un fallo al guardar: ${String(err)}`,
      );
      return;
    }

    const liberado = await this.facturaContadorModel
      .findOneAndUpdate(
        { _id: FACTURA_CONTADOR_ID, seq: numero },
        { $inc: { seq: -1 } },
      )
      .exec();

    if (liberado) {
      this.logger.warn(
        `Se libero el numero de factura ${numero} tras un fallo al guardar: ${String(err)}`,
      );
      return;
    }

    this.logger.error(
      `No se pudo recuperar el numero de factura ${numero}; quedo perdido (gap permanente en la numeracion) tras un fallo al guardar: ${String(err)}`,
    );
  }

  private async numeroPersistido(numero: number): Promise<boolean> {
    const existente = await this.facturaModel.findOne({ numero }).exec();
    return existente !== null;
  }

  /**
   * Atomically allocates the next correlative invoice number using
   * `$inc` on a dedicated counter document, avoiding the race condition
   * of reading the max `numero` and incrementing it in application code.
   */
  private async siguienteNumero(): Promise<number> {
    const contador = await this.facturaContadorModel
      .findOneAndUpdate(
        { _id: FACTURA_CONTADOR_ID },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      )
      .orFail()
      .exec();
    return contador.seq;
  }

  private generarId(numero: number): string {
    return `FAC-${String(numero).padStart(6, '0')}`;
  }

  private async obtenerEmisor() {
    const empresa = await this.empresaDatosService.obtener();
    if (!empresa) {
      return undefined;
    }
    return {
      nombre: empresa.nombre,
      nit: empresa.ruc_nit,
      direccion: empresa.direccion,
      telefono: empresa.telefono,
      email: empresa.email,
      ciudad: empresa.ciudad,
      pais: await this.obtenerNombrePais(empresa.pais),
    };
  }

  /**
   * Resolves the issuer's country name (T3) from the `Pais` nomenclador
   * referenced by `EmpresaDatos.pais` (an ObjectId, unlike the other
   * emisor fields which are already plain strings on EmpresaDatos).
   * Returns undefined when the company has no país configured, or when
   * the referenced Pais document no longer exists.
   */
  private async obtenerNombrePais(
    paisId: Types.ObjectId | undefined,
  ): Promise<string | undefined> {
    if (!paisId) {
      return undefined;
    }
    const pais = await this.paisModel.findById(paisId).exec();
    return pais?.nombrePais;
  }

  /**
   * Loads the warehouse referenced by the invoice (T2). Not found -> 404;
   * found but with no `codigo` configured -> 422 (the warehouse exists but
   * cannot be used to invoice yet, since the client contract requires the
   * warehouse code on every invoice). `almacenId` is passed through as-is:
   * Mongoose casts a Mongo id string to `ObjectId` case-insensitively, so an
   * uppercase-hex `almacenId` (still a valid `@IsMongoId`) resolves the same
   * document, with no manual normalization needed here.
   */
  private async obtenerAlmacenValido(
    almacenId: string,
  ): Promise<AlmacenDocument> {
    const almacen = await this.almacenModel.findById(almacenId).exec();
    if (!almacen) {
      throw new NotFoundException(`Almacén con ID ${almacenId} no encontrado`);
    }
    if (!almacen.codigo) {
      throw new UnprocessableEntityException(
        `El almacén "${almacen.nombreAlmacen}" no tiene código configurado`,
      );
    }
    return almacen;
  }

  /**
   * Loads every producto referenced by the items in a single `$in` query
   * (never N queries) and checks, for each item, that the productoId
   * exists and — when that producto has an assigned almacen — that it
   * matches the invoice's almacenId (T2). Both comparisons go through the
   * canonical (lowercase) hex form of the ObjectId: `producto._id` and
   * `producto.almacen` come back lowercase from Mongo, but `productoId` and
   * `almacenId` are raw strings validated only with `@IsMongoId`, so a
   * client sending uppercase hex must still match.
   */
  private async validarProductosDelAlmacen(
    items: { productoId: string }[],
    almacenId: string,
  ): Promise<void> {
    const productoIds = [...new Set(items.map((item) => item.productoId))];
    const productos = await this.productoModel
      .find({ _id: { $in: productoIds } })
      .exec();
    // Keyed by the canonical (lowercase) hex form so that a productoId sent
    // in a different case (e.g. uppercase hex, still a valid @IsMongoId)
    // resolves to the same producto instead of being reported as missing.
    const productosPorId = new Map<string, ProductoDocument>(
      productos.map((producto) => [producto._id.toString(), producto]),
    );
    const almacenIdCanonico = new Types.ObjectId(almacenId).toHexString();

    for (const productoId of productoIds) {
      const productoIdCanonico = new Types.ObjectId(productoId).toHexString();
      const producto = productosPorId.get(productoIdCanonico);
      if (!producto) {
        throw new BadRequestException(`El producto ${productoId} no existe`);
      }
      if (
        producto.almacen &&
        producto.almacen.toString() !== almacenIdCanonico
      ) {
        throw new BadRequestException(
          `El producto ${productoId} no pertenece al almacén seleccionado`,
        );
      }
    }
  }

  /**
   * Resolves "Facturado por" (T4) from the authenticated JWT user: the
   * employee record is loaded and snapshotted (name, CI, today's date in
   * the invoice timezone), never taken from the request body. The
   * employee no longer existing (e.g. the account was deleted right after
   * the token was issued) is an authentication failure, not a bad
   * request, so it throws 401 — and, run before `siguienteNumero()` (T9),
   * it never burns an invoice number.
   */
  private async obtenerFacturadorPor(userId: string): Promise<{
    empleadoId: Types.ObjectId;
    nombre: string;
    ci: string;
    fecha: string;
  }> {
    const usuario = await this.usuarioModel.findById(userId).exec();
    if (!usuario) {
      throw new UnauthorizedException('El usuario autenticado ya no existe');
    }
    return {
      empleadoId: usuario._id,
      nombre: usuario.nombre_empleado,
      ci: usuario.ci_empleado,
      fecha: obtenerFechaEnZona(FACTURA_TIMEZONE),
    };
  }

  /**
   * Looks up an existing client by nit, then email, then telefono — three
   * separate queries, first hit wins — instead of a single `$or`, which
   * could otherwise match a client on the wrong field (e.g. a phone
   * number that coincidentally equals another client's nit).
   */
  private async buscarCliente(criterios: {
    nit?: string;
    email?: string;
    telefono?: string;
  }): Promise<ClienteDocument | null> {
    const { nit, email, telefono } = criterios;

    if (nit) {
      const porNit = await this.buscarPorFiltro({ nit });
      if (porNit) {
        return porNit;
      }
    }
    if (email) {
      const porEmail = await this.buscarPorFiltro({ email_cliente: email });
      if (porEmail) {
        return porEmail;
      }
    }
    if (telefono) {
      const porTelefono = await this.buscarPorFiltro({
        telefono_cliente: telefono,
      });
      if (porTelefono) {
        return porTelefono;
      }
    }
    return null;
  }

  private async buscarPorFiltro(
    filtro: QueryFilter<Cliente>,
  ): Promise<ClienteDocument | null> {
    return this.clienteModel.findOne(filtro).exec();
  }

  /**
   * Only called with at least one of nit/telefono/email already guaranteed
   * truthy by the caller (`create`), so no need to re-check that here.
   */
  private async buscarOCrearCliente(datos: {
    nombre: string;
    nit?: string;
    telefono?: string;
    email?: string;
    direccion?: string;
  }): Promise<ClienteDocument | null> {
    const { nombre, nit, telefono, email, direccion } = datos;

    const existente = await this.buscarCliente({ nit, email, telefono });
    if (existente) {
      return existente;
    }

    const sufijo = new Types.ObjectId().toHexString().slice(-6);
    const nuevoCliente = new this.clienteModel({
      id_cliente: nit || `CLI-${sufijo}`,
      nombre_cliente: nombre,
      nit,
      telefono_cliente:
        telefono || `${FACTURA_CLIENTE_TELEFONO_PLACEHOLDER_PREFIJO}${sufijo}`,
      email_cliente:
        email ||
        `cliente-${sufijo}@${FACTURA_CLIENTE_EMAIL_PLACEHOLDER_DOMINIO}`,
      direccion_cliente: direccion || FACTURA_CLIENTE_DIRECCION_PLACEHOLDER,
    });

    try {
      return await nuevoCliente.save();
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Lost a race with a concurrent create: the client now exists,
        // re-query it by the same priority instead of failing.
        const recuperado = await this.buscarCliente({ nit, email, telefono });
        if (!recuperado) {
          // The client that won the race is now gone too (e.g. deleted
          // between the failed insert and this re-query). Log which
          // criteria were used, never the values, to avoid leaking PII.
          this.logger.warn(
            `Clave duplicada (E11000) al crear cliente, pero la re-consulta no encontro nada (criterios usados: ${this.criteriosUsados(
              { nit, email, telefono },
            )})`,
          );
        }
        return recuperado;
      }
      this.logger.warn(
        `No se pudo crear el cliente para la factura: ${String(err)}`,
      );
      return null;
    }
  }

  /** Lists which of nit/email/telefono were provided, never their values. */
  private criteriosUsados(criterios: {
    nit?: string;
    email?: string;
    telefono?: string;
  }): string {
    return Object.entries(criterios)
      .filter(([, valor]) => valor)
      .map(([clave]) => clave)
      .join(', ');
  }

  /**
   * Always bounded: defaults to page 1 / limit 50 when the caller sends
   * neither, so a listing can never return the whole collection unbounded.
   */
  async findAll(query: ListarFacturasQueryDto = {}): Promise<Factura[]> {
    const pagina = query.page ?? FACTURA_LISTADO_PAGINA_DEFECTO;
    const limite = query.limit ?? FACTURA_LISTADO_LIMITE_DEFECTO;
    return this.facturaModel
      .find()
      .sort({ numero: -1 })
      .skip((pagina - 1) * limite)
      .limit(limite)
      .exec();
  }

  async findOne(id: string): Promise<Factura> {
    const factura = await this.facturaModel.findOne({ id }).exec();
    if (!factura) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }
    return factura;
  }

  async update(
    id: string,
    updateFacturaDto: UpdateFacturaDto,
  ): Promise<Factura> {
    const actualizada = await this.facturaModel
      .findOneAndUpdate({ id, estado: { $ne: 'anulada' } }, updateFacturaDto, {
        new: true,
        runValidators: true,
      })
      .exec();
    if (actualizada) {
      return actualizada;
    }
    return this.lanzarNoEditable(id, 'modificada');
  }

  async anular(id: string): Promise<Factura> {
    const anulada = await this.facturaModel
      .findOneAndUpdate(
        { id, estado: { $ne: 'anulada' } },
        { estado: 'anulada' },
        { new: true, runValidators: true },
      )
      .exec();
    if (anulada) {
      return anulada;
    }
    return this.lanzarNoEditable(id, 'anulada');
  }

  /**
   * Distinguishes 404 (no such invoice) from 409 (invoice exists but is
   * already anulada) after a conditional `{ estado: { $ne: 'anulada' } }`
   * update matched nothing. Always throws.
   */
  private async lanzarNoEditable(id: string, accion: string): Promise<never> {
    const existente = await this.facturaModel.findOne({ id }).exec();
    if (!existente) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }
    throw new ConflictException(
      `La factura ${id} esta anulada y no puede ser ${accion}`,
    );
  }

  async remove(id: string): Promise<Factura> {
    const factura = await this.anular(id);
    return factura;
  }
}
