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
  EstadoFactura,
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
import {
  camposNoPermitidos,
  mensajeCamposNoPermitidos,
  mensajeTransicionInvalida,
  origenesPermitidos,
} from './factura-estado';

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
   * Seeds the invoice counter from the highest existing `numero` and
   * migrates legacy `estado` values so previously imported invoices
   * (created before this counter/enum existed) never collide with newly
   * allocated numbers or fail schema validation on their next write.
   */
  async onModuleInit(): Promise<void> {
    // Fail fast: an unrecognized FACTURA_TIMEZONE would otherwise only
    // surface as silently wrong invoice dates on every create().
    validarZonaHoraria(FACTURA_TIMEZONE);

    await this.migrarEstadoAjustada();

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
   * One-time, idempotent migration (T6a, `estadoLegado` added in T6b):
   * documents stored with the old `estado: 'ajustada'` (a value this
   * service itself never wrote, but present in data imported before this
   * enum existed) are normalized to `confirmada`, the closest current
   * state, while `estadoLegado: 'ajustada'` records the original value so
   * it is not lost. Runs before the counter seed so a legacy value never
   * blocks Mongoose schema validation on a later write; existing
   * `confirmada`/`anulada` documents are valid in the new enum as-is and
   * need no migration. Idempotent because the filter only ever matches
   * `estado: 'ajustada'`, which no longer holds after the first run.
   */
  private async migrarEstadoAjustada(): Promise<void> {
    // 'ajustada' predates the EstadoFactura enum, so it is not one of its
    // values; the cast only widens the filter's type for this one legacy
    // literal, it never bypasses runtime validation.
    const estadoLegacyAjustada = 'ajustada' as unknown as EstadoFactura;
    const resultado = await this.facturaModel
      .updateMany(
        { estado: estadoLegacyAjustada },
        {
          $set: {
            estado: EstadoFactura.CONFIRMADA,
            estadoLegado: 'ajustada',
          },
        },
      )
      .exec();
    if (resultado.modifiedCount > 0) {
      this.logger.log(
        `Migradas ${resultado.modifiedCount} factura(s) de estado "ajustada" a "confirmada"`,
      );
    }
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

    const clienteNombre =
      this.limpiarCampoTexto(createFacturaDto.cliente) ||
      FACTURA_CLIENTE_NOMBRE_POR_DEFECTO;
    const nit = this.limpiarCampoTexto(createFacturaDto.nit);
    const direccion = this.limpiarCampoTexto(createFacturaDto.direccion);
    const telefono = this.limpiarCampoTexto(createFacturaDto.telefono);
    const email = this.limpiarCampoTexto(createFacturaDto.email);

    const { items, subtotal, descuentoTotal, recargoTotal, impuesto, total } =
      calcularTotales(createFacturaDto.items, createFacturaDto.impuesto);

    // Both fallible (404/422/400) and run before siguienteNumero() (T9):
    // an invalid almacén or item never burns an invoice number.
    const almacen = await this.obtenerAlmacenValido(createFacturaDto.almacenId);
    await this.validarProductosDelAlmacen(items, createFacturaDto.almacenId);
    const facturadoPor = await this.obtenerFacturadorPor(userId);

    const emisor = await this.obtenerEmisor();

    const clienteId = await this.resolverClienteId({
      nombre: clienteNombre,
      nit,
      telefono,
      email,
      direccion,
    });

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
      estado: EstadoFactura.EDICION,
      tipo: createFacturaDto.tipo ?? 'factura_normal',
      impreso: createFacturaDto.impreso ?? false,
      talonario: createFacturaDto.talonario,
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

  /**
   * Trims a buyer text field and normalizes the "no value" sentinel some
   * frontend forms send (an em dash) to `''`. Shared by `create` and
   * `update` (T6b) so both apply the exact same cleanup to
   * cliente/nit/direccion/telefono/email.
   */
  private limpiarCampoTexto(valor?: string): string {
    const t = (valor ?? '').trim();
    return t === FACTURA_CAMPO_VACIO_SENTINEL ? '' : t;
  }

  /**
   * Resolves `clienteId` from already-cleaned buyer data: undefined when
   * none of nit/telefono/email is present (venta al público), otherwise
   * the matched-or-created client's id (`buscarOCrearCliente`). Shared by
   * `create` and, when buyer fields change, `update` (T6b).
   */
  private async resolverClienteId(datos: {
    nombre: string;
    nit?: string;
    telefono?: string;
    email?: string;
    direccion?: string;
  }): Promise<Types.ObjectId | undefined> {
    const { nit, telefono, email } = datos;
    if (!nit && !telefono && !email) {
      return undefined;
    }
    return (await this.buscarOCrearCliente(datos))?._id;
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

  /**
   * PATCH /facturas/:id (T6b): which fields may be set depends on the
   * invoice's current `estado` (`factura-estado.ts` —
   * `camposEditablesPorEstado`/`camposNoPermitidos`): `edicion` accepts
   * every business field (with items/impuesto/almacenId/cliente changes
   * re-validated and recomputed server-side, see
   * `construirActualizacion`); `terminada` only `fecha`/`talonario`/
   * `impreso`; `confirmada`/`cancelada` only `impreso`; `anulada` nothing.
   * Any other field present for the current state -> 409 naming both.
   *
   * Reads the invoice once (404 if missing) to decide what is allowed and
   * to build the `$set`, then persists with exactly one conditional
   * `findOneAndUpdate` keyed on the state just read — so a transition that
   * lands between the read and the write can never silently apply a stale
   * edit; `lanzarActualizacionConcurrente` re-disambiguates 404 vs 409 for
   * that race, mirroring `lanzarTransicionInvalida`.
   *
   * An update with no fields at all is a no-op: nothing is rejected
   * (there is nothing to check) and nothing is written, so the invoice is
   * returned unchanged instead of issuing an empty `$set`.
   */
  async update(
    id: string,
    updateFacturaDto: UpdateFacturaDto,
  ): Promise<Factura> {
    const factura = await this.facturaModel.findOne({ id }).exec();
    if (!factura) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }

    const estado = factura.estado;
    const camposRechazados = camposNoPermitidos(estado, updateFacturaDto);
    if (camposRechazados.length > 0) {
      throw new ConflictException(
        mensajeCamposNoPermitidos(id, estado, camposRechazados),
      );
    }

    if (Object.keys(updateFacturaDto).length === 0) {
      return factura;
    }

    const set = await this.construirActualizacion(
      estado,
      updateFacturaDto,
      factura,
    );

    const actualizada = await this.facturaModel
      .findOneAndUpdate(
        { id, estado },
        { $set: set },
        { new: true, runValidators: true },
      )
      .exec();
    if (actualizada) {
      return actualizada;
    }
    return this.lanzarActualizacionConcurrente(id, estado);
  }

  /**
   * Distinguishes 404 (invoice deleted) from 409 (a concurrent transition
   * changed `estado` between `update`'s read and its conditional write)
   * after that write matched nothing. Always throws.
   */
  private async lanzarActualizacionConcurrente(
    id: string,
    estadoEsperado: EstadoFactura,
  ): Promise<never> {
    const existente = await this.facturaModel.findOne({ id }).exec();
    if (!existente) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }
    throw new ConflictException(
      `La factura ${id} cambio de estado "${estadoEsperado}" a "${existente.estado}" antes de aplicar la edicion; reintente`,
    );
  }

  /**
   * Builds the `$set` for `update` from the fields `camposNoPermitidos`
   * already confirmed are allowed for `estado`. `fecha`/`talonario`/
   * `impreso` need no transformation and are valid in every editable
   * state, so they are handled once up front; everything else is only
   * reachable while `estado` is `edicion` (every other allowed state only
   * permits that first group).
   */
  private async construirActualizacion(
    estado: EstadoFactura,
    dto: UpdateFacturaDto,
    actual: Factura,
  ): Promise<Record<string, unknown>> {
    const set: Record<string, unknown> = {};

    if (dto.fecha !== undefined) {
      set.fecha = dto.fecha;
    }
    if (dto.talonario !== undefined) {
      set.talonario = dto.talonario;
    }
    if (dto.impreso !== undefined) {
      set.impreso = dto.impreso;
    }

    if (estado !== EstadoFactura.EDICION) {
      return set;
    }

    if (dto.concepto !== undefined) {
      set.concepto = dto.concepto;
    }
    if (dto.moneda !== undefined) {
      set.moneda = dto.moneda;
    }
    if (dto.metodoPago !== undefined) {
      set.metodoPago = dto.metodoPago;
    }
    if (dto.despachadoPor !== undefined) {
      set.despachadoPor = dto.despachadoPor;
    }
    if (dto.transportadoPor !== undefined) {
      set.transportadoPor = dto.transportadoPor;
    }
    if (dto.recibidoPor !== undefined) {
      set.recibidoPor = dto.recibidoPor;
    }

    await this.aplicarCambiosDeItemsYAlmacen(dto, actual, set);
    await this.aplicarCambiosDeCliente(dto, actual, set);

    return set;
  }

  /**
   * When `items` and/or `impuesto` change, recomputes every total with
   * `calcularTotales` — using the stored items when only `impuesto`
   * changed, and vice versa, exactly like `create`. When `items` or
   * `almacenId` change, re-runs `obtenerAlmacenValido` +
   * `validarProductosDelAlmacen` (against the new items when they
   * changed, the stored ones otherwise) and refreshes `almacenId`/
   * `almacenCodigo`. An invoice with no `almacenId` at all (legacy, from
   * before T2) that changes its items without also sending `almacenId`
   * has no warehouse to validate against, so it is rejected with 422
   * instead of silently skipping the check.
   */
  private async aplicarCambiosDeItemsYAlmacen(
    dto: UpdateFacturaDto,
    actual: Factura,
    set: Record<string, unknown>,
  ): Promise<void> {
    const itemsCambiaron = dto.items !== undefined;
    const impuestoCambio = dto.impuesto !== undefined;

    if (itemsCambiaron || impuestoCambio) {
      const itemsEntrada = itemsCambiaron ? dto.items! : actual.items;
      const impuestoEntrada = impuestoCambio ? dto.impuesto : actual.impuesto;
      const { items, subtotal, descuentoTotal, recargoTotal, impuesto, total } =
        calcularTotales(itemsEntrada, impuestoEntrada);
      set.items = items;
      set.subtotal = subtotal;
      set.descuentoTotal = descuentoTotal;
      set.recargoTotal = recargoTotal;
      set.impuesto = impuesto;
      set.total = total;
    }

    const almacenIdCambio = dto.almacenId !== undefined;
    if (!itemsCambiaron && !almacenIdCambio) {
      return;
    }

    const almacenId = almacenIdCambio
      ? dto.almacenId!
      : actual.almacenId?.toString();
    if (!almacenId) {
      throw new UnprocessableEntityException(
        'La factura no tiene almacén asignado; envíe almacenId para modificar sus items',
      );
    }
    const itemsParaValidar =
      (set.items as { productoId: string }[] | undefined) ?? actual.items;
    const almacen = await this.obtenerAlmacenValido(almacenId);
    await this.validarProductosDelAlmacen(itemsParaValidar, almacenId);
    set.almacenId = almacen._id;
    set.almacenCodigo = almacen.codigo;
  }

  /**
   * When any buyer field (`cliente`, `nit`, `direccion`, `telefono`,
   * `email`) changes, merges the change with the invoice's stored values,
   * cleans it exactly like `create` (`limpiarCampoTexto`), and re-runs the
   * same client matching/creation (`resolverClienteId`) so `clienteId`
   * always reflects the current buyer data.
   */
  private async aplicarCambiosDeCliente(
    dto: UpdateFacturaDto,
    actual: Factura,
    set: Record<string, unknown>,
  ): Promise<void> {
    const camposCliente = [
      'cliente',
      'nit',
      'direccion',
      'telefono',
      'email',
    ] as const;
    const algunoCambio = camposCliente.some(
      (campo) => dto[campo] !== undefined,
    );
    if (!algunoCambio) {
      return;
    }

    const clienteNombre =
      dto.cliente !== undefined
        ? this.limpiarCampoTexto(dto.cliente) ||
          FACTURA_CLIENTE_NOMBRE_POR_DEFECTO
        : actual.cliente;
    const nit =
      dto.nit !== undefined
        ? this.limpiarCampoTexto(dto.nit)
        : (actual.nit ?? '');
    const direccion =
      dto.direccion !== undefined
        ? this.limpiarCampoTexto(dto.direccion)
        : (actual.direccion ?? '');
    const telefono =
      dto.telefono !== undefined
        ? this.limpiarCampoTexto(dto.telefono)
        : (actual.telefono ?? '');
    const email =
      dto.email !== undefined
        ? this.limpiarCampoTexto(dto.email)
        : (actual.email ?? '');

    set.cliente = clienteNombre;
    set.nit = nit;
    set.direccion = direccion;
    set.telefono = telefono;
    set.email = email;
    set.clienteId = await this.resolverClienteId({
      nombre: clienteNombre,
      nit,
      telefono,
      email,
      direccion,
    });
  }

  /** `terminar` (T6a): closes edicion for the normal edit flow. */
  async terminar(id: string): Promise<Factura> {
    return this.transicionar(id, EstadoFactura.TERMINADA);
  }

  /** `editar` (T6a): reopens a terminada invoice back to edicion. */
  async volverAEdicion(id: string): Promise<Factura> {
    return this.transicionar(id, EstadoFactura.EDICION);
  }

  /**
   * Confirms the invoice (T6a: state only). T7 adds the inventory
   * decrease + Kardex `venta` movement here, with compensation on partial
   * failure; kept as its own method now so that side effect has one clear
   * place to land.
   */
  async confirmar(id: string): Promise<Factura> {
    return this.transicionar(id, EstadoFactura.CONFIRMADA);
  }

  /**
   * Rolls a confirmed invoice back (T6a: state only). T7 adds the
   * inventory increase + Kardex `devolucion` movement here, mirroring
   * `confirmar`.
   */
  async cancelar(id: string): Promise<Factura> {
    return this.transicionar(id, EstadoFactura.CANCELADA);
  }

  async anular(id: string): Promise<Factura> {
    return this.transicionar(id, EstadoFactura.ANULADA);
  }

  /**
   * Single conditional `findOneAndUpdate` that both claims a state
   * transition and checks the invoice's current state in one atomic
   * write: `origenesPermitidos(destino)` (factura-estado.ts) becomes the
   * `$in` filter, so no other state can match. The invoice's `numero`/`id`
   * are never touched here (anular never releases or reuses them, see
   * `siguienteNumero`/`compensarNumeroTrasFalloDeGuardado`).
   */
  private async transicionar(
    id: string,
    destino: EstadoFactura,
  ): Promise<Factura> {
    const actualizada = await this.facturaModel
      .findOneAndUpdate(
        { id, estado: { $in: origenesPermitidos(destino) } },
        { $set: { estado: destino } },
        { new: true, runValidators: true },
      )
      .exec();
    if (actualizada) {
      return actualizada;
    }
    return this.lanzarTransicionInvalida(id, destino);
  }

  /**
   * Distinguishes 404 (no such invoice) from 409 (invoice exists but is
   * not in an allowed origin state for `destino`) after the conditional
   * transition update above matched nothing. Always throws.
   */
  private async lanzarTransicionInvalida(
    id: string,
    destino: EstadoFactura,
  ): Promise<never> {
    const existente = await this.facturaModel.findOne({ id }).exec();
    if (!existente) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }
    throw new ConflictException(
      mensajeTransicionInvalida(id, existente.estado, destino),
    );
  }

  /** DELETE /facturas/:id (T4): alias of `anular`, never a hard delete. */
  async remove(id: string): Promise<Factura> {
    const factura = await this.anular(id);
    return factura;
  }
}
