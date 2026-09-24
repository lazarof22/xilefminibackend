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
- [ ] T2 Warehouse code: unique `codigo` on `Almacen` (schema + DTOs); invoice references the warehouse (`almacenId`) and snapshots `almacenCodigo`; items must belong to that warehouse when the product has one
- [ ] T3 Document data: issuer snapshot includes `ciudad` and `pais`; `metodoPago` validated against the `TipoPago` enum
- [ ] T4 Auth + "Facturado por": JWT + roles guards on `FacturaController`; `facturadoPor { empleadoId, nombre, ci, fecha }` from the logged-in user
- [ ] T5 Participants: `despachadoPor`, `transportadoPor`, `recibidoPor` `{ nombre, ci, fecha }` (optional, editable while `edicion`)
- [ ] T6 State machine: new `estado` enum, default `edicion`, transition endpoints (`terminar`, `editar`, `confirmar`, `cancelar`, `anular`), per-state edit rules, `talonario` field, legacy mapping, annulled-code uniqueness test
- [ ] T7 Inventory movements: `confirmar` decreases stock + Kardex `venta`; `cancelar` increases stock + Kardex `devolucion`; Kardex gets a `referencia` to the invoice; compensation on partial failure
- [ ] T8 Contract docs for the frontend + runtime smoke test against local MongoDB (if available)

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
  - Commit: see T2 evidence (hash recorded in the following commit).

## Known environmental failures
- `src/modules/configuracion/usuarios/usuarios.service.spec.ts` › `UsuariosService › create › should create a user with hashed password` (fails on base `d4bd1df`).

## Next step
T2 warehouse code.
