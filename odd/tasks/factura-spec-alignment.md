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
- [ ] T7 Inventory movements (only invoices confirmed after this feature carry `inventarioAplicado: true`; cancelling a legacy `confirmada` must not add stock back): `confirmar` decreases stock + Kardex `venta`; `cancelar` increases stock + Kardex `devolucion`; Kardex gets a `referencia` to the invoice; compensation on partial failure
- [ ] T8 Final frontend contract review + runtime smoke test against local MongoDB (if available); each task already updates `src/modules/factura/README.md`

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
- `npx jest` green, `npm run build` green, `npx eslint` clean on touched files, no `any`.
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

## Known environmental failures
- `src/modules/configuracion/usuarios/usuarios.service.spec.ts` › `UsuariosService › create › should create a user with hashed password` (fails on base `d4bd1df`).

## Next step
T7 inventory movements.
