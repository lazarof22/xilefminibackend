# Factura spec alignment

## Objective
Align `src/modules/factura` with the client specification in `Anotaciones del xilefmini.docx` ("TABLA DE UNA FACTURA"), excluding signatures.

## Problem / Why
Today the invoice module is disconnected from inventory, users/roles and warehouses. It only knows `Cliente` and `EmpresaDatos`. The spec requires:
- warehouse code on the invoice;
- full company data (name, email, address, phone, RUC/NIT, city, country);
- "Facturado por" = the logged-in user (name, CI, date);
- "Despachado por", "Transportado por", "Recibido por" (name, CI, date);
- client data, payment type;
- invoice lifecycle `Edición / Terminada / Confirmada / Cancelada / Anulada` with inventory side effects:
  - Terminada: only `fecha` / `talonario` editable, can be annulled, no inventory movement;
  - Confirmada: inventory decrease;
  - Cancelada: a confirmed invoice rolled back, inventory increase;
  - Anulada: its code can never be reused by another invoice.
- user roles `Administrador, Gerente, Económico, Cajero, Facturador`.

## Scope
- `src/modules/factura/**`
- `src/modules/auth/schemas/empleado.schema.ts` (roles enum)
- `src/modules/inventario/almacen/**` (warehouse `codigo`)
- `src/modules/inventario/kardex/schema/kardex.schema.ts` (movement reference)
- `src/modules/inventario/producto/**` only as a read/update dependency (stock).

## Out of scope
- Signatures (explicitly excluded by the user).
- `Producto` schema bug (`categoria_producto` / `estado` marked `unique: true`), inventory report "reserved" stock, IPV report. Separate work.
- Frontend changes.

## Decisions
- **State machine** (proposed by the assistant, the user said "haz todo" without objecting; revisit if they change it):
  - `edicion` (default on create) -> `terminada` | `anulada`
  - `terminada` -> `edicion` | `confirmada` | `anulada`
  - `confirmada` -> `cancelada`
  - `cancelada` -> terminal
  - `anulada` -> terminal
  - Legacy `confirmada` documents stay `confirmada`; legacy `ajustada` (never written by the service) is read as `confirmada`.
- **Edit rules**: `edicion` = every business field editable and totals recomputed server-side; `terminada` = only `fecha` and `talonario`; any other state = read-only (409).
- **Payment type**: enum `efectivo | transferencia | credito`, the same methods the `pago` module already handles.
- **Roles**: add `gerente` and `economico` to `UsuarioRol`; keep existing `administrador, empleado, jefe, facturador, cajero` for backward compatibility. No `almacenero` role: "Despachado / Transportado / Recibido por" are free data (name, CI, date), not system users.
- **Access**: all factura endpoints require JWT. Create/edit/transitions: `administrador`, `gerente`, `facturador`. Read: any authenticated user.
- **Facturado por**: taken server-side from the JWT user (`Empleado.nombre_empleado`, `ci_empleado`) at creation; never from the request body.
- **Inventory without transactions**: MongoDB runs standalone (`mongodb://localhost:27017`, no replica set, no `startSession` anywhere in the repo), so multi-document transactions are unavailable. Confirm/cancel use conditional atomic updates plus compensation: claim the state transition with a conditional `findOneAndUpdate`, then apply per-item stock `$inc` guarded by `stock_inicial >= cantidad`, and roll back (previous stock updates + state) on any failure. `stock_inicial` is the live stock field, consistent with `VentaService`.
- **Invoice code**: `numero` / `id` are allocated by the atomic counter and never reused; annulled codes stay reserved because the counter never goes back over them. Enforced by the unique index and pinned with an explicit test.

## Tasks
- [x] T1 Roles: add `gerente`, `economico` to `UsuarioRol`
- [x] T2 Warehouse code: unique `codigo` on `Almacen` (schema + DTOs); invoice references the warehouse (`almacenId`) and snapshots `almacenCodigo`; items must belong to that warehouse when the product has one
- [x] T2b Warehouse code hardening (from T2 review warnings): reject whitespace-only `codigo`, reject `codigo: null` on update, normalize ObjectId comparison (uppercase hex), README error messages accurate
- [x] T3 Document data: issuer snapshot includes `ciudad` and `pais`; `metodoPago` validated against the `TipoPago` enum; participants `despachadoPor`, `transportadoPor`, `recibidoPor` `{ nombre, ci, fecha }` (merged from T5: same files, one coherent contract change)
- [x] T4 Auth + "Facturado por": JWT + roles guards on `FacturaController`; `facturadoPor { empleadoId, nombre, ci, fecha }` from the logged-in user
- T5 (no checkbox: merged into T3, tracked there) (same schema/DTO/README surface; per-state edit restriction lands with T6)
- [x] T6a States and transitions: `EstadoFactura` enum (default `edicion`), pure transition table, endpoints `terminar`, `editar` (back to edicion), `confirmar`, `cancelar`, `anular` (+ `DELETE` alias) with conditional atomic updates, legacy `ajustada` -> `confirmada` migration, annulled-code-never-reused test
- [x] T6b Edit rules per state: `edicion` edits every business field (totals, warehouse/product checks and client link re-run server-side), `terminada` only `fecha` + `talonario` (new field), others 409; carry-overs: reject `null` participants, `metodoPago` typed `TipoPago`, `impreso` settable in every state except `anulada` (non-fiscal print flag), `ajustada` migration keeps `estadoLegado: 'ajustada'`
- [x] T6c Fix T6b defects: (1) ignore `undefined`-valued keys everywhere in update (field check, empty-body check, `$set` builder) and test with real `plainToInstance` DTO instances; (2) optimistic concurrency: `revision` counter `$inc`'d by every update/transition and matched by update's conditional write (lost update R1/R3); (3) review readability warnings: single source for the state/field table, accurate concurrency comments
- [x] T7 Inventory movements (only invoices confirmed after this feature carry `inventarioAplicado: true`; cancelling a legacy `confirmada` must not add stock back): `confirmar` decreases stock + Kardex `venta`; `cancelar` increases stock + Kardex `devolucion`; Kardex gets a `referencia` to the invoice; compensation on partial failure
- [x] T7b Inventory hardening (T7 review): in-progress marker so `cancelar` cannot claim while a confirm is applying stock; revert failure never masks the original error; ambiguous decrement write errors logged for manual reconciliation; Kardex accepts fractional quantities and writes unordered so one bad row never drops the batch; accurate messages/README; drop dead guard
- [x] T7c Inventory guard tolerant to `Mixed` ObjectId paths (found by T8): match `almacen` / `estado` / `_id` both as ObjectId and as string, and write Kardex/other refs as real ObjectIds
- [x] T8 Final frontend contract review + runtime smoke test against local MongoDB (if available); each task already updates `src/modules/factura/README.md`

## Route
Delegated direct, one bounded writer per task (writer trigger: every task touches 2+ non-trivial files: schema, DTO, service, specs). The parent reviews, spot-checks and commits.

## Constraints
- No `any`; explicit types.
- TDD: strict (source: global user config `Strict TDD Mode: enabled`), runner `npx jest` (Jest 30 + ts-jest), focused `npx jest src/modules/factura`.
- Baseline: branch `feat/factura-spec-alignment` from `master` @ `d4bd1df`; `npx jest src/modules/factura` -> 78 passed (7 suites); `npm run build` clean.
- ~400 authored changed lines per task is a planning heuristic only, not a cap.

## Delivery
- Forecast: ~1500-2000 authored changed lines (above the ~400 delivery budget).
- Strategy: `ask-on-risk` (default) -> chain strategy: `feature-branch-chain` (user choice, 2026-09-24).
- Slices (PR -> commits): recorded as tasks close.

## Acceptance
- `npx jest` green, `npm run build` green, `npx tsc --noEmit` clean, `npx eslint` clean on touched files, no `any`.
- Every spec item above (except signatures) is covered by code and tests.

## Progress / Evidence
- Setup: CodeGraph initialized in the repo; Engram session registered for project `xilefminibackend`; `npm ci` run (warning: `bcrypt` install script not approved by npm `allow-scripts`, may affect runtime login, not unit tests).

- T1 done (route: direct inline, one enum + one spec; no delegation trigger fired). `UsuarioRol` gains `GERENTE='gerente'`, `ECONOMICO='economico'`; usuarios README lists every role.
  - RED: `npx jest src/modules/configuracion/usuarios/dto` -> 2 failed, 4 passed (`gerente`, `economico` rejected by `@IsEnum`).
  - GREEN: same command -> 6 passed. `npm run build` -> clean.
  - Known pre-existing failure (base `d4bd1df`, unrelated): `usuarios.service.spec.ts` "should create a user with hashed password" -> `created.toObject is not a function` (mock lacks `toObject`). Full suite: 268 passed, 1 failed (that one).
  - Commit: `9a233fb` feat(auth): agrega los roles gerente y economico
  - Native review: assess `high` (hot path `auth`), consent granted by the user, 4 lenses, lineage `review-61f9c79086c8a5c5` approved and acknowledged (authority burned). 5 non-blocking suggestions (spec helper naming, legacy roles untested, fixture refs as strings, deferred commit evidence). Reviewed boundary -> `9a233fb`.

- T2 done (route: delegated direct, one writer; writer trigger: 17 files across almacen + factura). `Almacen.codigo` (trim, unique+sparse for legacy docs), required in create DTO (MaxLength 20), optional in update; E11000 -> 409 in `AlmacenService` via local `almacen-mongo-errors.ts`. `CreateFacturaDto.almacenId` required (`@IsMongoId`); `ItemFacturaDto.productoId` now `@IsMongoId`. `FacturaService.create` loads the warehouse (404 missing, 422 without `codigo`) and all products in one `$in` query (400 when a product is missing or belongs to another warehouse), before `siguienteNumero()` (T9 rule kept). Invoice persists `almacenId` + snapshot `almacenCodigo` (optional in schema for legacy, not editable). Almacen/Producto models registered in `FacturaModule` via `forFeature` (same pattern as Cliente). README updated.
  - RED: `npx jest src/modules/inventario/almacen` -> 10 failed / 8 passed; `npx jest src/modules/factura` -> 9 failed / 80 passed.
  - GREEN: `npx jest src/modules/factura src/modules/inventario/almacen` -> 107 passed (11 suites) (parent re-ran: 107 passed). Full `npx jest` -> 297 passed, 1 failed (known). `npm run build` clean. eslint clean on touched files except 4 pre-existing non-prettier almacen files (4-space/double quotes, unused Swagger imports on base; left untouched to keep the diff focused). No `any`.
  - Decision: missing product -> 400 (item-level input error, same validation pass as the warehouse mismatch).
  - Commit: `bde0e36` feat(factura): registra el codigo del almacen y valida los productos del almacen
  - Native review: assess `high` (hot path update DTO, process boundary in spec), consent granted, 4 lenses, lineage `review-94d4d9990ed7e7e9` approved and acknowledged (burned). 12 non-blocking findings; the real defects became T2b. Reviewed boundary -> `bde0e36`.

- T2b done (route: delegated direct, one writer). Almacen DTOs trim `codigo` via `@Transform` before validation (whitespace-only rejected); update DTO uses `@ValidateIf(v !== undefined)` so `codigo: null` is rejected; `validarProductosDelAlmacen` compares canonical lowercase hex (`new Types.ObjectId(id).toHexString()`), `findById` already case-insensitive (pinned by test); README explains the legacy 422 and the `PATCH /almacen/:id` fix.
  - RED: `npx jest src/modules/factura/factura.service.spec.ts src/modules/inventario/almacen` -> 7 failed / 62 passed.
  - GREEN: `npx jest src/modules/factura src/modules/inventario/almacen` -> 115 passed (parent re-ran: 115 passed). Full `npx jest` -> 305 passed, 1 failed (known). Build clean. No `any`.
  - Commit: `e61d203` fix(almacen): rechaza codigos vacios o nulos y compara ids sin distinguir mayusculas
  - Native review: assess `high`, consent granted, 4 lenses, lineage `review-61ec7edd40927ed4` approved and acknowledged (burned). 5 advisories (duplicated trim transform, test naming, trim persistence not proven end-to-end, absent-codigo update case); non-defect, left as notes. Reviewed boundary -> `e61d203`.

- T3 done (route: delegated direct, one writer; also covers merged T5). `TipoPago` enum (`efectivo|transferencia|credito`) in `factura.constants.ts`, `@IsEnum` on `metodoPago` + schema enum (legacy strings still load: update validators only touch updated paths). `EmisorDatos` gains `ciudad`/`pais`; `EmpresaDatos.pais` is an ObjectId ref to the `Pais` nomenclador, so the service resolves `nombrePais` (undefined if unset or dangling, never blocks creation). `ParticipanteFactura { nombre, ci, fecha }` subdocument for `despachadoPor`/`transportadoPor`/`recibidoPor`, optional on create, editable via PATCH (per-state rules in T6). README updated.
  - RED: `npx jest src/modules/factura` -> 13 failed / 101 passed.
  - GREEN: same -> 114 passed (parent re-ran: 114 passed). Full `npx jest` -> 327 passed, 1 failed (known). Build clean, eslint + prettier clean, no `any`.
  - Size: ~626 authored lines (over the ~400 heuristic because of DTO/service spec coverage for three features; not trimmed).
  - Commit: `581be08` feat(factura): agrega ciudad y pais del emisor, tipo de pago y participantes del despacho
  - Native review: assess `high`, consent granted, 4 lenses, lineage `review-68639bf2ac422b8e` approved and acknowledged (burned). 11 advisories; carried into T6: PATCH accepts `null` participants (R1-001/R3), `metodoPago` typed `string` instead of `TipoPago` in the schema (R4-001), comment wording in `TipoPago` doc (R2-001). Reviewed boundary -> `581be08`.

- T4 done (route: delegated direct, one writer). Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@ApiBearerAuth()` on `FacturaController`; `@Roles(administrador, gerente, facturador)` on create/update/anular/remove; reads have no `@Roles` (`RolesGuard` allows when metadata is absent). New `auth/types/jwt-user.type.ts` (`JwtUser`, `RequestWithUser`, matching `JwtStrategy.validate`). `facturadoPor { empleadoId (ref Usuario), nombre, ci, fecha }` snapshotted server-side from the JWT `userId` before number allocation; employee gone -> 401. README: auth, roles table, 401/403.
  - RED: `npx jest src/modules/factura` -> 10 failed / 116 passed.
  - GREEN: `npx jest src/modules/factura src/modules/auth` -> 126 passed (parent re-ran: 126 passed). Full `npx jest` -> 339 passed, 1 failed (known). Build, eslint, prettier clean; no `any`.
  - Correction: `DELETE /facturas/:id` is already a logical annulment (alias of `anular`, verified in README/controller), not a hard delete. T6 keeps it as an alias subject to the same transition rules.
  - Commit: `357c9d3` feat(factura): exige autenticacion por rol y registra quien factura
  - Native review: assess `high` (auth), consent granted, 4 lenses, lineage `review-f8aba9197956f8e7` approved and acknowledged (burned). 9 advisories (spec naming, README wording, controller spec asserting metadata only). Reviewed boundary -> `357c9d3`.

- T6a done (route: delegated direct, one writer). `EstadoFactura` enum (schema `type: String`, default `edicion`); pure `factura-estado.ts` (`esTransicionValida`, `origenesPermitidos`, `mensajeTransicionInvalida`) with an exhaustive 25-pair spec; service `transicionar(id, destino)` = one conditional `findOneAndUpdate` on `estado $in origenesPermitidos(destino)`, then 404/409 disambiguation; public `terminar`, `volverAEdicion`, `confirmar`, `cancelar`, `anular` (+ `DELETE` alias); new `PATCH :id/terminar|editar|confirmar|cancelar` with write roles; PATCH update only while `edicion` (T6b widens); `onModuleInit` migrates legacy `ajustada` -> `confirmada` idempotently; tests pin `id`/`numero` unique and that annulment never touches the counter. README: states, transition table + diagram, endpoints.
  - RED: `factura-estado.spec.ts` module not found; service spec 20 failed / 58 passed; controller spec 8 failed / 10 passed. (Disclosed: `schema/factura.schema.spec.ts` written as a pinning test, not RED-first, for uniqueness that pre-existed.)
  - GREEN: `npx jest src/modules/factura` -> 193 passed (parent re-ran: 193 passed). Full `npx jest` -> 406 passed, 1 failed (known). Build, eslint clean; no `any` (legacy filter uses a documented `as unknown as EstadoFactura` cast).
  - Commit: `02eccc5` feat(factura): agrega el ciclo de estados de la factura con transiciones atomicas
  - Native review: assess `high`, consent granted, 4 lenses, lineage `review-6af72d4dc4318b99` approved and acknowledged (burned). 11 advisories; carried into T6b: `impreso` can no longer be set once the invoice leaves `edicion` (R4/R3), `ajustada` migration is lossy (R4). Reviewed boundary -> `02eccc5`.

- T6b done (route: delegated direct, one writer). Pure per-state field permissions in `factura-estado.ts` (`camposEditablesPorEstado`, `camposNoPermitidos`): edicion = every business field; terminada = `fecha`, `talonario`, `impreso`; confirmada/cancelada = `impreso`; anulada = nothing (409 names state + rejected fields). `UpdateFacturaDto` picks every business field; participants and `talonario` reject `null` (`@ValidateIf`) on create and update. `update()` reads once (404), checks fields (409), empty body = no-op, recomputes totals / re-validates warehouse+products / re-links client in edicion via helpers shared with create (`limpiarCampoTexto`, `resolverClienteId`), persists with one conditional `findOneAndUpdate({ id, estado })`, race -> 404/409. 422 when items change on a legacy invoice without warehouse. Schema: `metodoPago: TipoPago`, `talonario`, `estadoLegado`; the `ajustada` migration now sets `estadoLegado: 'ajustada'`.
  - RED: estado helpers missing; schema spec 2 failed; service spec 23 failed.
  - GREEN: `npx jest src/modules/factura` -> 238 passed (parent re-ran: 238 passed). Full `npx jest` -> 451 passed, 1 failed (known). Build, eslint clean; no `any`.
  - Size: ~1270 authored lines (tests ~60%); not trimmed.
  - Parent concern to verify in review: concurrent edits in `edicion` are only guarded by `estado`, so two simultaneous PATCHes could lose one update.
  - Commit: `fe21b9f` feat(factura): aplica las reglas de edicion segun el estado y agrega el talonario
  - Native review: assess `high`, consent granted, 4 lenses, lineage `review-a0f42ad0c4a42d74` approved and acknowledged (burned). 10 advisories, two confirmed as real defects -> T6c. Reviewed boundary -> `fe21b9f`.
  - Parent reproduction (R3-object-keys-undefined-fields): `target: ES2023` emits class fields with define semantics, so `plainToInstance(UpdateFacturaDto, { fecha })` on the built `dist` has own keys `despachadoPor, transportadoPor, recibidoPor, talonario` = `undefined`; `camposNoPermitidos('terminada', dto)` -> `['despachadoPor','transportadoPor','recibidoPor']` => PATCH `{ fecha }` on a terminada invoice returns 409 in production. Unit tests missed it because they pass plain objects.

- T6c done (route: delegated direct, one writer; first attempt cut by a rate limit before writing anything, relaunched from `fe21b9f`). `camposPresentes(dto)` (own keys with value !== undefined) used by `camposNoPermitidos`, the empty-body check and the `$set` builder, which now derives from `camposEditablesPorEstado` (single source). Optimistic concurrency: `revision` (no schema default, so legacy docs read `undefined` and match `{ revision: { $exists: false } }`), `create` sets 0, `update` and `transicionar` `$inc` it, `update` matches the read revision; mismatch -> 409 "cambio mientras se editaba; reintente". `ESTADO_LEGADO_AJUSTADA` constant. README: `revision` + retry advice.
  - Evidence (writer, throwaway local mongod, Mongoose 9.1.5): Mongoose strips `undefined` keys from update documents, so `AlmacenService.update` passing a DTO with undefined `codigo` does not erase it (safe, no change). A schema `default: 0` would backfill reads and break legacy matching, hence no default.
  - RED: `npx jest src/modules/factura/factura-estado.spec.ts src/modules/factura/factura.service.spec.ts` -> 24 failed / 124 passed (real `plainToInstance` DTOs).
  - GREEN: `npx jest src/modules/factura src/modules/inventario/almacen` -> 274 passed. Full -> 464 passed, 1 failed (known). Parent re-ran factura tests and the `dist` reproduction: `terminada` + `{ fecha }` -> `[]`.

  - Commits: `1e6a16c` fix(factura): ignora campos no enviados al editar y evita perder ediciones concurrentes; `68a5777` test(factura): corrige los tipos de los mocks del spec del servicio
  - Native review (range `fe21b9f..68a5777`): assess `high`, consent granted, 4 lenses, lineage `review-fabb5ea0458dc9a4` approved and acknowledged (burned). 6 suggestions/warnings, readability only (items proxy gate naming, parallel `CAMPOS_SIMPLES` list, test name). Reviewed boundary -> `68a5777`.
- T6c follow-up: `npx tsc --noEmit` showed 7 type errors in `factura.service.spec.ts` accumulated since T2 (ts-jest `isolatedModules` does not type-check): mock casts now go through `unknown`, `metodoPago` fixture uses `TipoPago.EFECTIVO`. `npx tsc --noEmit` -> 0 errors; factura tests 251 passed. `tsc --noEmit` added to every task's verification from now on.

- T7 done (route: delegated direct, one writer on opus: highest-consequence task). New collaborator `FacturaInventarioService` (`rebajarStock`, `restaurarStock`, pure `agregarCantidadesPorProducto` sorted by canonical productoId). `confirmar` claims `confirmada` + `inventarioAplicado: true` + `$inc revision`, then decrements each product with a guarded `findOneAndUpdate` (`stock_inicial $gte`, same warehouse or none, not inactive); on first failure compensates applied decrements, reverts to `terminada` (matching the claimed revision) and throws 409 naming the product (missing / inactive / other warehouse / disponible vs solicitado). Kardex `venta` via one `insertMany` with `referencia`; Kardex failure logged, stock not rolled back. `cancelar` restores stock + Kardex `devolucion` only when `inventarioAplicado && !inventarioRevertido`; legacy confirmed invoices cancel without touching stock. Inactive estado read-only lookup (`/^inactivo$/i`, never created). Kardex schema gains optional `referencia` (file reformatted with prettier: it was not prettier-clean).
  - RED: stub collaborator -> `npx jest src/modules/factura` 23 failed / 256 passed.
  - GREEN: `npx jest src/modules/factura src/modules/inventario` -> 302 passed (parent re-ran). Full -> 492 passed, 1 failed (known). Build clean, `tsc --noEmit` 0 errors (parent re-ran), eslint clean, no `any`.
  - Commit: `471c1ad` feat(factura): mueve el inventario y el kardex al confirmar y cancelar la factura
  - Native review: assess `high`, consent granted, 4 lenses, lineage `review-de1fdd1abd0367b1` approved and acknowledged (burned). 12 advisories converging on the confirm/cancel window, revert error masking, ambiguous decrement writes and Kardex batch loss -> T7b. Reviewed boundary -> `471c1ad`.
  - Known limitations (documented in README, candidates for follow-up): (1) a `cancelar` landing inside the window of a `confirmar` that then fails could restore stock that was never decreased (revert then logs an error); closing it needs an in-progress marker. (2) Kardex `cantidad` has `min: 1` while item `cantidad` allows fractions: a 0.5 unit moves stock but its Kardex write fails (logged). (3) Stock reaching 0 does not flip the product to inactive (same as `VentaService`).

- T7b done (route: delegated direct, one writer on opus). `inventarioEnProceso` marker set by the confirm/cancel claims and cleared by the finalizing write; `cancelar` claims only with the marker absent (409 "se está confirmando; reintente"); revert/finalize match the marker instead of `revision` (a concurrent `impreso` PATCH cannot make them miss). Revert never throws and never masks the original stock error (logs full context). Ambiguous decrement write errors logged "conciliar a mano", not compensated. Kardex `cantidad` > 0 (fractions allowed; compra/transferencia/manual writers verified compatible), `insertMany({ ordered: false })` logs exactly the failed rows. Accurate 409 when stock changed during the confirm. Dead `inventarioRevertido` guard removed (flag kept for audit). README: marker, `terminada` guarantees, limitations.
  - RED: `npx jest src/modules/factura src/modules/inventario` -> 23 failed / 295 passed.
  - GREEN: same -> 318 passed (parent re-ran). Full -> 508 passed, 1 failed (known). Build clean, `tsc --noEmit` 0 errors (parent re-ran), eslint clean, no `any`.
  - Commit: `7229f7e` fix(factura): protege el inventario ante cancelaciones concurrentes y fallos parciales
  - Native review: assess `high`, consent granted, 4 lenses, lineage `review-92e4a146e731fbd6` approved and acknowledged (burned). 6 advisories, all about log accuracy (Kardex failed-row index shape, all-rows fallback) and the stuck-marker 409 wording; left as follow-ups. Reviewed boundary -> `7229f7e`.
  - Remaining limitations: a crash mid-movement leaves the marker set (cancel answers 409 until fixed by hand, documented); ambiguous writes/failed compensations need manual reconciliation from logs.

- T8 runtime smoke test (route: delegated worker; throwaway mongod 8.0.28 on port 27098, app `node dist/main` on 3099, db `xilefmini_smoke`, deleted after). 17 scenarios all as documented: 401 without token, 403 cajero, 400 other-warehouse product, create (edicion, almacenCodigo, facturadoPor, emisor ciudad/pais, revision 0), edicion PATCH recomputes totals (258 -> 300) and increments revision, terminada `{fecha}` 200 / `{concepto}` 409 / `{impreso}` 200, confirmar stock 10 -> 7 + Kardex venta with referencia, re-confirm 409, cancelar stock 7 -> 10 + Kardex devolucion, re-cancel 409, over-stock confirm 409 with stock unchanged and back to terminada, annulled numero 3 never reused (next 4). README matched observed behavior; no edits. Login uses `bcryptjs`, so the `bcrypt` install warning is irrelevant.
  - CODE BUG found (parent verified): in Mongoose 9.9.5 `mongoose.Types.ObjectId !== mongoose.Schema.Types.ObjectId`, so every `@Prop({ type: Types.ObjectId, ref })` (22 schema files project-wide) becomes a `Mixed` path (`Producto.almacen`, `Factura.almacenId`, `Kardex.productoId` all `Mixed`). Products created via `POST /producto` store `almacen` as a string, so the T7 guard `{ almacen: { $in: [null, ObjectId] } }` never matches and `confirmar` fails with a misleading 409 on real data. Smoke test only passed after fixing product data by hand. -> T7c (factura-scoped). Project-wide schema fix is a separate decision for the user.

- T7c done (route: delegated direct, one writer on opus). New `factura-ids.ts` (`variantesHex`, `variantesId`, `idCanonico`, `mismoId`). Confirm guard: `almacen $in [null, oid, hex, HEX]` (Mixed path); `estado $nin [hex, HEX]` (`Producto.estado` is a String path, so Mongoose stringifies ObjectIds); 409 diagnosis and `validarProductosDelAlmacen` use `mismoId`. `_id` lookups unchanged (real ObjectId path). Writes already store real ObjectIds (`Kardex.productoId`, `almacenId`, `clienteId`, `empleadoId`). Limitation (README): mixed-case stored ids are not matched at confirm.
  - RED: `npx jest src/modules/factura` -> 6 failed / 288 passed + missing module.
  - GREEN: `npx jest src/modules/factura src/modules/inventario` -> 332 passed (parent re-ran). Full -> 522 passed, 1 failed (known). Build clean, `tsc` 0 errors (parent re-ran), eslint clean.
  - Runtime proof (throwaway mongod 8.0.28, port 27123, built service, raw-inserted products): almacen stored as string / uppercase string / ObjectId -> all decrement (stock 7); inactive-as-string -> 409 inactivo; other warehouse -> 409; Kardex productoId stored as ObjectId; pre-T7c filter matches string-stored product 0, T7c filter 1. mongod stopped, dbpath deleted.

  - Commit: `8b2f11b` fix(factura): reconoce ids guardados como texto u ObjectId al mover el inventario
  - Native review: assess `high`, consent granted, 4 lenses, lineage `review-639318bdcf180d98` approved and acknowledged (burned). 6 suggestions only. Reviewed boundary -> `8b2f11b`.
- T8 closed: runtime smoke test (17 scenarios) passed; the only defect it found (Mixed ObjectId paths) is fixed for factura in T7c and proven against a throwaway mongod. README verified against observed behavior.
- Final verification (parent, HEAD `8b2f11b`): `npx jest` -> 522 passed, 1 failed (known, pre-existing); `npm run build` clean; `npx tsc --noEmit` 0 errors. Branch total vs `d4bd1df` (excluding `odd/`): 34 files, +5777/-256 (majority tests), 12 commits.

## Follow-ups (out of scope, need a user decision)
- Project-wide: 22 schema files use `@Prop({ type: Types.ObjectId })`, which Mongoose 9 turns into `Mixed` paths (no casting, ids stored as strings by some writers). Proper fix: `mongoose.Schema.Types.ObjectId` + a data migration converting string ids.
- `Producto` schema: `categoria_producto` and `estado` marked `unique: true` (only one product per category/estado).
- Inventory report "reserved" stock and IPV report from the same client document.
- Log-accuracy advisories from the T7b review (Kardex failed-row index shape, stuck-marker 409 wording).
- Pre-existing failing test `usuarios.service.spec.ts` (mock lacks `toObject`).

## Delivery
- Chain strategy `feature-branch-chain`. Suggested PR slices (≈ review units already reviewed natively): (1) T1+T2+T2b roles & warehouse, (2) T3+T4 document data & auth, (3) T6a+T6b+T6c states & edit rules, (4) T7+T7b+T7c inventory. Push / PR creation are the user's decision.

## Known environmental failures
- `src/modules/configuracion/usuarios/usuarios.service.spec.ts` › `UsuariosService › create › should create a user with hashed password` (fails on base `d4bd1df`).

## Next step
Feature complete. Awaiting the user's decisions on delivery (push/PRs) and follow-ups.
