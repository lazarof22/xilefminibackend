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
import { FacturaInventarioService } from './factura-inventario.service';
import {
  ESTADO_LEGADO_AJUSTADA,
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
  camposEditablesPorEstado,
  camposNoPermitidos,
  camposPresentes,
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
    private readonly inventario: FacturaInventarioService,
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
    // ESTADO_LEGADO_AJUSTADA predates the EstadoFactura enum, so it is not
    // one of its values; the cast only widens the filter's type for this
    // one legacy literal, it never bypasses runtime validation.
    const estadoLegacyAjustada =
      ESTADO_LEGADO_AJUSTADA as unknown as EstadoFactura;
    const resultado = await this.facturaModel
      .updateMany(
        { estado: estadoLegacyAjustada },
        {
          $set: {
            estado: EstadoFactura.CONFIRMADA,
            estadoLegado: ESTADO_LEGADO_AJUSTADA,
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
      revision: 0,
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
   * Any other field actually present (`camposPresentes`, T6c) for the
   * current state -> 409 naming both.
   *
   * Reads the invoice once (404 if missing) to decide what is allowed and
   * to build the `$set`, then persists with one conditional
   * `findOneAndUpdate` keyed on the `estado` AND `revision` (T6c) just
   * read: matching only that exact `revision` closes the lost-update race
   * left by matching `estado` alone (two concurrent PATCHes in `edicion`
   * both read the same `estado` and could otherwise both match, one
   * silently overwriting the other's derived totals/almacén/cliente). A
   * legacy invoice (persisted before `revision` existed) reads back as
   * `undefined` — never backfilled to `0`, see `factura.schema.ts` — so it
   * is matched with `{ revision: { $exists: false } }` instead; either way
   * the write also `$inc`s `revision`, so the very next PATCH always has a
   * `revision` to match. When nothing matches (deleted, a concurrent
   * transition, or a lost race on `revision`), `lanzarActualizacionConcurrente`
   * re-disambiguates 404 vs 409, mirroring `lanzarTransicionInvalida`.
   *
   * An update with no fields actually present at all (`camposPresentes`,
   * T6c — own keys with an `undefined` value, e.g. from
   * `plainToInstance`, never count) is a no-op: nothing is rejected
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

    if (camposPresentes(updateFacturaDto).length === 0) {
      return factura;
    }

    const set = await this.construirActualizacion(
      estado,
      updateFacturaDto,
      factura,
    );

    const revision = factura.revision;
    const filtroRevision =
      revision === undefined ? { revision: { $exists: false } } : { revision };

    const actualizada = await this.facturaModel
      .findOneAndUpdate(
        { id, estado, ...filtroRevision },
        { $set: set, $inc: { revision: 1 } },
        { new: true, runValidators: true },
      )
      .exec();
    if (actualizada) {
      return actualizada;
    }
    return this.lanzarActualizacionConcurrente(id);
  }

  /**
   * After `update`'s conditional write (`estado` + `revision`, T6c)
   * matches nothing, distinguishes 404 (invoice deleted) from 409 (some
   * other change — a concurrent transition, or another concurrent PATCH
   * that already advanced `revision` — landed between the read and the
   * write). Both concurrent-write causes now share one generic message:
   * unlike before `revision` existed, a mismatch can no longer be
   * attributed to `estado` alone. Always throws.
   */
  private async lanzarActualizacionConcurrente(id: string): Promise<never> {
    const existente = await this.facturaModel.findOne({ id }).exec();
    if (!existente) {
      throw new NotFoundException(`Factura con ID ${id} no encontrada`);
    }
    throw new ConflictException(
      `La factura ${id} cambio mientras se editaba; reintente`,
    );
  }

  /**
   * Fields whose PATCH value can be copied into `$set` as-is, with no
   * derived computation. Every other editable field (`items`, `impuesto`,
   * `almacenId`, and the buyer fields `cliente`/`nit`/`direccion`/
   * `telefono`/`email`) instead triggers derived recomputation, handled by
   * `aplicarCambiosDeItemsYAlmacen` / `aplicarCambiosDeCliente`.
   */
  private static readonly CAMPOS_SIMPLES = [
    'fecha',
    'talonario',
    'impreso',
    'concepto',
    'moneda',
    'metodoPago',
    'despachadoPor',
    'transportadoPor',
    'recibidoPor',
  ] as const;

  /**
   * Builds the `$set` for `update` from the fields actually present
   * (`camposPresentes`, T6c) that `camposNoPermitidos` already confirmed
   * are allowed for `estado`. Which fields are allowed for `estado` is
   * read once from `camposEditablesPorEstado` (`factura-estado.ts`) — the
   * single source of truth also used to build the 409 — instead of
   * duplicating that per-state field list here as a second hardcoded
   * `estado` check (T6c readability fix): a field only reaches `$set` when
   * it is both in `CAMPOS_SIMPLES` (or the items/cliente derived group)
   * AND in `camposEditablesPorEstado(estado)`.
   */
  private async construirActualizacion(
    estado: EstadoFactura,
    dto: UpdateFacturaDto,
    actual: Factura,
  ): Promise<Record<string, unknown>> {
    const set: Record<string, unknown> = {};
    const presentes = new Set(camposPresentes(dto));
    const editables = camposEditablesPorEstado(estado);
    const dtoRegistro = dto as unknown as Record<string, unknown>;

    for (const campo of FacturaService.CAMPOS_SIMPLES) {
      if (editables.includes(campo) && presentes.has(campo)) {
        set[campo] = dtoRegistro[campo];
      }
    }

    if (!editables.includes('items')) {
      return set;
    }

    await this.aplicarCambiosDeItemsYAlmacen(dto, actual, set, presentes);
    await this.aplicarCambiosDeCliente(dto, actual, set, presentes);

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
    presentes: Set<string>,
  ): Promise<void> {
    const itemsCambiaron = presentes.has('items');
    const impuestoCambio = presentes.has('impuesto');

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

    const almacenIdCambio = presentes.has('almacenId');
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
    presentes: Set<string>,
  ): Promise<void> {
    const camposCliente = [
      'cliente',
      'nit',
      'direccion',
      'telefono',
      'email',
    ] as const;
    const algunoCambio = camposCliente.some((campo) => presentes.has(campo));
    if (!algunoCambio) {
      return;
    }

    const clienteNombre = presentes.has('cliente')
      ? this.limpiarCampoTexto(dto.cliente) ||
        FACTURA_CLIENTE_NOMBRE_POR_DEFECTO
      : actual.cliente;
    const nit = presentes.has('nit')
      ? this.limpiarCampoTexto(dto.nit)
      : (actual.nit ?? '');
    const direccion = presentes.has('direccion')
      ? this.limpiarCampoTexto(dto.direccion)
      : (actual.direccion ?? '');
    const telefono = presentes.has('telefono')
      ? this.limpiarCampoTexto(dto.telefono)
      : (actual.telefono ?? '');
    const email = presentes.has('email')
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
   * Confirms the invoice and decreases its stock (T7). The claim also sets
   * `inventarioAplicado`, so only one concurrent confirm can win and stock
   * is never decreased twice. If the stock cannot be decreased (the
   * collaborator has already compensated its own writes), the invoice goes
   * back to `terminada` and the error (409 naming the product) is rethrown.
   */
  async confirmar(id: string): Promise<Factura> {
    const reclamada = await this.transicionar(id, EstadoFactura.CONFIRMADA, {
      inventarioAplicado: true,
    });
    try {
      await this.inventario.rebajarStock(reclamada);
    } catch (error) {
      await this.revertirConfirmacion(reclamada);
      throw error;
    }
    return reclamada;
  }

  /**
   * Undoes the confirm claim after a failed stock decrease. Matches the
   * `revision` the claim produced, so it never overwrites a later write;
   * without transactions a mismatch cannot be fixed here, only logged.
   */
  private async revertirConfirmacion(reclamada: Factura): Promise<void> {
    const revertida = await this.facturaModel
      .findOneAndUpdate(
        {
          id: reclamada.id,
          estado: EstadoFactura.CONFIRMADA,
          revision: reclamada.revision,
        },
        {
          $set: { estado: EstadoFactura.TERMINADA },
          $unset: { inventarioAplicado: 1 },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .exec();
    if (!revertida) {
      this.logger.error(
        `La factura ${reclamada.id} quedó confirmada sin rebaja de stock (cambió antes de revertirla a terminada, revision ${reclamada.revision}); corregir a mano`,
      );
    }
  }

  /**
   * Rolls a confirmed invoice back (T7). Stock is restored (Kardex
   * `devolucion`) only when this feature's `confirmar` decreased it:
   * legacy `confirmada` invoices (no `inventarioAplicado`) are cancelled
   * without touching stock or Kardex. `cancelada` is terminal and the claim
   * only matches `confirmada`, so the restore runs at most once.
   */
  async cancelar(id: string): Promise<Factura> {
    const reclamada = await this.transicionar(id, EstadoFactura.CANCELADA);
    if (
      reclamada.inventarioAplicado !== true ||
      reclamada.inventarioRevertido === true
    ) {
      return reclamada;
    }
    await this.inventario.restaurarStock(reclamada);
    const marcada = await this.facturaModel
      .findOneAndUpdate(
        { id, estado: EstadoFactura.CANCELADA },
        { $set: { inventarioRevertido: true }, $inc: { revision: 1 } },
        { new: true },
      )
      .exec();
    return marcada ?? reclamada;
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
   *
   * Also `$inc`s `revision` (T6c), like `update`, so `revision` keeps
   * advancing across every write to the invoice, not just PATCHes. The
   * transition itself needs no `revision` match: `estado` alone is already
   * an atomic, race-free filter here, since transitions never derive
   * fields from the invoice's prior state the way `update` does.
   */
  private async transicionar(
    id: string,
    destino: EstadoFactura,
    camposExtra: Partial<Pick<Factura, 'inventarioAplicado'>> = {},
  ): Promise<Factura> {
    const actualizada = await this.facturaModel
      .findOneAndUpdate(
        { id, estado: { $in: origenesPermitidos(destino) } },
        { $set: { estado: destino, ...camposExtra }, $inc: { revision: 1 } },
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
