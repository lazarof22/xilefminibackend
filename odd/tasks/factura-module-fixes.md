# Factura module fixes

## Objective
Fix the bugs found in the audit of `src/modules/factura` (copied from xilefbackend), with strict typing (no `any`) and tests.

## Problem / Why
Concurrent creates collide on `numero`, totals are trusted from the client (or default to 0), invoices can be edited or "un-annulled" after emission, dates use UTC, client matching can link the wrong customer and swallows errors, and DTO validation is too permissive.

## Scope
- `src/modules/factura/**` only (plus a new counter schema inside the module).
- Out of scope: auth guards (open project-wide), frontend changes.

## Constraints
- No `any`; explicit types everywhere.
- TDD: strict (source: global user config `Strict TDD Mode: enabled`), runner `npx jest src/modules/factura`.
- Baseline commit: `f366305 feat(factura): import factura module from xilefbackend`.
- Contract change: `id`, `numero`, `estado`, `total` removed from create DTO (server-controlled). The frontend currently stores invoices in localStorage and does not POST them yet.

## Totals formula (matches xilefminifrontend FacturacionTab)
- gross = precio * cantidad
- rawDiscount = descuentoMonto + gross * descuentoPct / 100
- lineDiscount = min(rawDiscount, gross + recargo) — clamped (T10) so a line can never go negative and the invariant below always holds, even when the client sends an over-discount
- item.total = max(0, gross - lineDiscount + recargo) (the `max(0, …)` is now a belt-and-braces safety net; the clamp above already guarantees non-negativity)
- subtotal = Σ gross; descuentoTotal = Σ lineDiscount (clamped); recargoTotal = Σ recargo
- base = Σ item.total; impuesto.importe = base * porciento / 100 when porciento is set; total = base + importe
- Invariant (held exactly, within `redondear`'s 2-decimal rounding): `subtotal - descuentoTotal + recargoTotal === base`
- `redondear` (T10): deterministic half-up rounding to 2 decimals, symmetric for negatives (`Math.round(Number((Math.abs(n)*100).toFixed(8)))/100`, sign restored) — avoids both raw binary floating-point error (`2.675*100 === 267.49999999999997`) and JS `Math.round`'s banker's-rounding-adjacent behavior on negative numbers.

## Tasks
- [x] T1 Atomic correlative numbering (counter collection with `$inc`, seeded from max existing `numero`) — fixes #1, part of #8
- [x] T2 Server-side totals, tax calculation, stricter DTO validation, server-controlled fields removed from create — fixes #2, #6, #7, #8
- [x] T3 Restricted update DTO (only mutable fields), reject edits on annulled invoices, swagger mapped types — fixes #3, #9
- [x] T4 Local-timezone default date (America/Havana) + `YYYY-MM-DD` validation — fixes #4
- [x] T5 Deterministic client matching (nit > email > phone), duplicate-key recovery, logged failures — fixes #5
- [x] T6 Optional pagination on `findAll` (`page`, `limit`) — fixes #10

### Review follow-ups (native review review-1bfec93a25e1e19a, approved with advisories; user authorized fixing them)
- [x] T7 Always-bounded `findAll`: default limit 50, max 500, response stays `Factura[]` — R1-002, R4-findall-unbounded-default
- [x] T8 Issuer (`emisor`) always taken from EmpresaDatos; removed from create DTO — R1-003
- [x] T9 No burned invoice numbers: run every fallible step (emisor, client, date, totals, `validate()`) before allocating; on save failure roll the counter back conditionally, otherwise log the gap with the lost `numero` — R3/R4 numero-gap
- [x] T10 Hardening: validate `FACTURA_TIMEZONE` at startup (fail fast); log when E11000 re-query finds nothing; clamp line discount so `subtotal - descuentoTotal + recargoTotal == base`; strict rounding test; Swagger 409 responses; readability cleanups (merge duplicate impuesto interfaces, rename `asegurarEditable`, name the placeholder constants, drop dead guard) — R3/R2 advisories
- [x] T11 Runtime smoke test against local MongoDB with the server running (create, list, get, patch, anular, 409 paths, concurrent creates)

## Route
Delegated direct: one writer (writer trigger: 2+ non-trivial files).

## Acceptance
- `npx jest src/modules/factura` green, `npm run build` green, `npx eslint src/modules/factura` clean, no `any` in the module.

## Progress / Evidence
- T1 done. Added `schema/factura-contador.schema.ts` (`factura_contadores` collection, `_id: string`, `seq: number`) and registered it in `factura.module.ts`. `FacturaService.siguienteNumero()` now allocates via `findOneAndUpdate({_id:'factura'}, {$inc:{seq:1}}, {upsert:true,new:true}).orFail()`; `id`/`numero` sent by the client are now ignored (server always allocates and builds `FAC-######`). `onModuleInit()` seeds the counter with `updateOne({_id:'factura'}, {$max:{seq:<max numero>}}, {upsert:true})`.
  - RED: `npx jest src/modules/factura` → 4 failed (`Cannot read properties of undefined (reading 'sort')`, `numero` not 7, `onModuleInit is not a function` x2).
  - GREEN: `npx jest src/modules/factura` → 4 passed.
  - `npm run build` → clean.
  - Commit: `d347603` fix(factura): allocate invoice numbers atomically

- T2 done. Added pure `factura-totales.ts` (`calcularTotales`, `redondear`) implementing the formula from Scope; `FacturaService.create` now always recomputes items/subtotal/descuentoTotal/recargoTotal/impuesto/total server-side and always sets `estado: 'confirmada'`. `CreateFacturaDto`/`ItemFacturaDto` tightened: removed `id`, `numero`, `estado`, `total` (invoice), `subtotal`, `descuentoTotal`, `recargoTotal`, and item `total` (never accepted, recomputed); added `@ArrayMinSize(1)` on items, `@IsPositive()` on `cantidad`, `@Min(0)` on `precio`/`costo`/`descuentoMonto`/`recargo`, `@Min(0)/@Max(100)` on `descuentoPct` and `impuesto.porciento`, `@Min(0)` on `impuesto.importe`. Tax rule: `porciento` set -> importe recomputed (client importe ignored); else client `importe` used if defined (0 valid); else no tax.
  - RED (`factura-totales.spec.ts`): module-not-found (file didn't exist yet).
  - GREEN (`factura-totales.spec.ts`): 8 passed.
  - RED (`create-factura.dto.spec.ts`): 5 failed (server-controlled fields still whitelisted, empty items accepted, impuesto bounds not enforced, item.total still required).
  - GREEN (`create-factura.dto.spec.ts`): 8 passed.
  - RED (`factura.service.spec.ts` T2 describe block): 3 failed (client totals/estado trusted, tax importe not recomputed).
  - GREEN: `npx jest src/modules/factura` -> 23 passed (3 suites).
  - `npm run build` -> clean. `npx eslint "src/modules/factura/**/*.ts"` -> clean (fixed unsafe-mock-typing/prettier issues in the spec files with typed `jest.Mock<T, unknown[]>` generics instead of `any`).
  - Commit: `400aaaf` fix(factura): compute totals and tax server-side, tighten DTO

- T3 done. `UpdateFacturaDto` rebuilt with `@nestjs/swagger` `PartialType(PickType(CreateFacturaDto, ['concepto','impreso','direccion','telefono','email']))`, so items/totals/numero/estado/fecha/nit are rejected by the global `forbidNonWhitelisted` pipe. `FacturaService.update`/`anular` now use a single conditional `findOneAndUpdate({id, estado:{$ne:'anulada'}}, ..., {new:true, runValidators:true})`; when it matches nothing, a private `asegurarEditable()` re-queries by `id` alone to distinguish 404 (no such invoice) from 409 `ConflictException` (exists but already anulada) — avoiding the earlier read-then-write race.
  - RED (`update-factura.dto.spec.ts`): 1 failed (`fecha` still accepted, since `UpdateFacturaDto` was `PartialType(CreateFacturaDto)`, i.e. every field).
  - RED (`factura.service.spec.ts` T3 describe block): 4 failed (no conditional `estado` filter, no `runValidators`, `anular` on an already-anulada invoice returned 404 instead of 409).
  - GREEN: `npx jest src/modules/factura` -> 32 passed (4 suites).
  - `npm run build` -> clean. `npx eslint "src/modules/factura/**/*.ts"` -> clean. `rg -n "\bany\b" src/modules/factura` -> only prose in `it(...)` descriptions/comments, no type usages.
  - Commit: `8b341a2` fix(factura): restrict update DTO and reject edits on annulled invoices

- T4 done. Added `factura-fecha.ts` (`obtenerFechaEnZona(timezone, fecha?)`) using `Intl.DateTimeFormat('en-CA', {timeZone,...})` to compute `YYYY-MM-DD` in a given IANA timezone instead of UTC. `FACTURA_TIMEZONE` constant in `factura.constants.ts` (`America/Havana`, overridable via `FACTURA_TIMEZONE` env var). `FacturaService.create` now defaults `fecha` via `obtenerFechaEnZona(FACTURA_TIMEZONE)` instead of `new Date().toISOString().split('T')[0]`. `CreateFacturaDto.fecha` now validated with `@Matches(/^\d{4}-\d{2}-\d{2}$/)` plus `@IsDateString({strict:true})` (rejects e.g. `2026-02-30`).
  - RED (`factura-fecha.spec.ts`): module-not-found (file didn't exist).
  - GREEN (`factura-fecha.spec.ts`): 3 passed, including the UTC-day-boundary case from the task brief (`2026-09-23T02:00:00Z` -> `2026-09-22` in Havana, UTC-4 in September).
  - RED (`create-factura.dto.spec.ts` fecha block + `factura.service.spec.ts` T4 block): 3 failed (malformed/impossible dates accepted; default fecha used UTC, off by one day near midnight).
  - GREEN: `npx jest src/modules/factura` -> 41 passed (5 suites).
  - `npm run build` -> clean. `npx eslint "src/modules/factura/**/*.ts"` -> clean. `rg -n "\bany\b" src/modules/factura` -> only prose, no type usage.
  - Commit: `34d83ee` fix(factura): default invoice date to America/Havana, validate format

- T5 done. Added `factura-mongo-errors.ts` (`isDuplicateKeyError(err: unknown): boolean`, typed guard for Mongo E11000). `buscarOCrearCliente` now looks up via a new `buscarCliente()` that runs three separate `findOne` queries in priority order (nit -> email_cliente -> telefono_cliente, first hit wins) instead of a single `$or`, so a phone number can no longer accidentally match another client's nit. On `nuevoCliente.save()` throwing an E11000 duplicate key (lost a create race), it re-queries by the same priority and returns that client instead of failing. On any other save error, it calls `this.logger.warn(...)` (Nest `Logger`, injected as `private readonly logger`) and returns `null` — no more empty `catch {}`. Found a mongoose typing note: this project's mongoose (9.9.5) renamed `FilterQuery<T>` to `QueryFilter<T>`; `npm run build` initially failed with `TS2614: Module "mongoose" has no exported member 'FilterQuery'` and was fixed by importing `QueryFilter` instead.
  - RED (`factura-mongo-errors.spec.ts`): module-not-found (file didn't exist).
  - GREEN (`factura-mongo-errors.spec.ts`): 4 passed.
  - RED (`factura.service.spec.ts` T5 describe block): 5 failed (single `$or` query instead of 3 priority queries, no duplicate-key retry, no logging on generic errors).
  - GREEN: `npx jest src/modules/factura` -> 50 passed (6 suites).
  - `npm run build` -> initially failed on `FilterQuery` (see above); clean after switching to `QueryFilter`.
  - `npx eslint "src/modules/factura/**/*.ts"` -> clean (an intermediate `no-unsafe-argument` warning on the untyped filter argument went away once `QueryFilter<Cliente>` was applied).
  - `rg -n "\bany\b" src/modules/factura` -> only prose, no type usage.
  - Commit: `b7a6e87` fix(factura): deterministic client matching with duplicate-key recovery

- T6 done. Added `dto/listar-facturas-query.dto.ts` (`ListarFacturasQueryDto`: `page`/`limit` optional, `@Type(() => Number)` + `@IsInt` + `@Min(1)`, `limit` also `@Max(500)`). `FacturaService.findAll(query: ListarFacturasQueryDto = {})` still returns `Factura[]` (non-breaking); now sorts by `numero` desc (was `createdAt`, which doesn't reflect the correlative order) and applies `skip((page-1)*limit).limit(limit)` only when `limit` is provided (page defaults to 1 when only limit is sent; page alone without limit is a no-op, since skip without limit is meaningless for pagination). Controller `GET /facturas` now takes `@Query() query: ListarFacturasQueryDto`.
  - RED (`listar-facturas-query.dto.spec.ts`): module-not-found (file didn't exist).
  - RED (`factura.service.spec.ts` T6 describe block): 3 failed (`findAll()` took no params, sorted by `createdAt`, never paginated).
  - GREEN: `npx jest src/modules/factura` -> 60 passed (7 suites).
  - `npm run build` -> clean. `npx eslint "src/modules/factura/**/*.ts"` -> clean. `rg -n "\bany\b" src/modules/factura` -> only prose, no type usage.
  - Commit: (recorded after commit below)

- T7 done. `findAll` is now always bounded: added `FACTURA_LISTADO_PAGINA_DEFECTO` (1), `FACTURA_LISTADO_LIMITE_DEFECTO` (50) and `FACTURA_LISTADO_LIMITE_MAXIMO` (500) to `factura.constants.ts`; `FacturaService.findAll` now applies `query.page ?? 1` / `query.limit ?? 50` unconditionally (previously it only paginated when `limit` was explicitly sent, so a caller that sent nothing got the whole collection). `ListarFacturasQueryDto.limit`'s `@Max` now references `FACTURA_LISTADO_LIMITE_MAXIMO`, and both fields document their default via `@ApiPropertyOptional({ default: ... })`. Response type is unchanged (`Factura[]`).
  - RED: `npx jest src/modules/factura` → 3 failed (`findAll({})`/`findAll({page:3})`/`findAll()` did not call `skip`/`limit`).
  - GREEN: `npx jest src/modules/factura` → 61 passed.
  - `npm run build` → clean.
  - Commit: `c0e2fa5` fix(factura): bound invoice listing by default

- T8 done. Removed `emisor`/`EmisorDatosDto` from `CreateFacturaDto` (the global `forbidNonWhitelisted` pipe now rejects any request that still sends `emisor`); `EmisorDatosDto` had no other usage so it was deleted outright (the `EmisorDatos` schema subdocument in `factura.schema.ts` is untouched). `FacturaService.create` now always does `const emisor = await this.obtenerEmisor();` instead of `createFacturaDto.emisor ?? (await this.obtenerEmisor())`.
  - RED: `create-factura.dto.spec.ts` → 1 failed (`emisor` still accepted by the whitelist); `factura.service.spec.ts` → 2 failed (client-sent `emisor` still won over `obtenerEmisor()`).
  - GREEN: `npx jest src/modules/factura` → 64 passed.
  - `npm run build` → clean.
  - Commit: (recorded after commit below)

- T9 done. `FacturaService.create` no longer allocates `numero` first. It now: computes `fecha`/totals/`emisor`/client, builds the `Factura` document WITHOUT `numero`/`id`, then runs `await factura.validate({ pathsToSkip: ['numero', 'id'] })` — a failed validation throws before the counter is ever touched. Only after that does it call `siguienteNumero()`, assign `factura.numero`/`factura.id` on the already-validated document, and `save()`. If `save()` throws (e.g. a lost race on the unique `numero` index), a new `compensarNumeroTrasFalloDeGuardado(numero, err)` runs `findOneAndUpdate({ _id: 'factura', seq: numero }, { $inc: { seq: -1 } })`: if it matches (no later invoice has allocated a number since), the number is released and `logger.warn` records it; if it doesn't match, the number is a permanent gap and `logger.error` records it naming the `numero` and the original error. The original error is always rethrown either way. Extended the shared test harness (`factura.service.spec.ts`) with a `validate` mock on the constructed instance and a `Logger.prototype.error` spy (needed by every existing test, not just T9's).
  - RED: `npx jest src/modules/factura/factura.service.spec.ts` → 4 failed (validate never called; counter allocated before validation; no rollback attempt or logging on save failure).
  - GREEN: `npx jest src/modules/factura` → 68 passed (had to update one T1 assertion that read `numero`/`id` off the constructor call args — they're now assigned after construction, so it reads `facturaModelMock.mock.instances[0]` instead).
  - `npm run build` → clean. `npx eslint "src/modules/factura/**/*.ts"` → clean (after `--fix` for prettier formatting only). `rg -n ":\s*any\b|as any|<any>|any\[\]" src/modules/factura` → empty.
  - Commit: (recorded after commit below)

- T10 done. Continued from a previously-interrupted writer's uncommitted edits (already had: `validarZonaHoraria` + its `factura-fecha.spec.ts` tests, the E11000-re-query-finds-nothing warn log + its `factura.service.spec.ts` test, named placeholder constants in `factura.constants.ts` used by `factura.service.ts`/`factura.schema.ts`, and the dead duplicate `!nit && !telefono && !email` guard already removed from `buscarOCrearCliente`). Finished the remaining hardening:
  - `factura-totales.ts`: `redondear` rewritten to deterministic half-up rounding restoring sign (`Math.round(Number((Math.abs(n)*100).toFixed(8)))/100`), fixing both `2.675`-style binary floating-point error and asymmetric rounding of negatives. `calcularTotales` now clamps `lineDiscount = min(rawDiscount, gross + recargo)` (previously only the resulting `total` was clamped via `max(0, …)`, which let `descuentoTotal` count more discount than was actually applied, breaking the `subtotal - descuentoTotal + recargoTotal === base` invariant under an over-discount + surcharge).
  - `factura.controller.ts`: added `@ApiResponse({status:409})` to `PATCH :id`, `PATCH :id/anular`, `DELETE :id`; added `@ApiResponse({status:400})` to `PATCH :id` (the only one of those three with a body to validate).
  - `factura-totales.ts`: merged the two structurally-identical `ImpuestoEntrada`/`ImpuestoCalculado` interfaces into one `Impuesto` (no external usages outside the file, confirmed via `rg`).
  - `factura.service.ts`: renamed the always-throwing `asegurarEditable` to `lanzarNoEditable` (no external references, confirmed via `rg`).
  - Updated this doc's "Totals formula" section (see above) with the clamp and the invariant.
  - RED (`factura-totales.spec.ts`, inherited from the interrupted writer): 2 failed — `redondear(-1.005)` returned `-1` instead of `-1.01`; the over-discount invariant test expected `descuentoTotal: 15` but got `50` (unclamped).
  - GREEN: `npx jest src/modules/factura` → 74 passed (7 suites).
  - `npm run build` → clean. `npx eslint "src/modules/factura/**/*.ts"` → clean. `rg -n ":\s*any\b|as any|<any>|any\[\]" src/modules/factura` → empty.
  - Commit: `<recorded below>`

- T11 done. No system `mongod` service was reachable (`mongosh --eval 'db.runCommand({ping:1})'` → `ECONNREFUSED 127.0.0.1:27017`; `sudo -n service/systemctl start mongod` both failed with "interactive authentication is required"). Started a standalone `mongod --dbpath <mktemp -d /tmp/factura-smoke.XXXXXX> --fork --logpath <dir>/mongod.log --port 27018` instead (per the task's fallback). No local routes on `/facturas` are guarded (no `@UseGuards`/global `APP_GUARD` — confirmed via `rg`), so no auth was needed. Built (`npm run build`) and ran `node dist/main.js` with `MONGODB_URI=mongodb://127.0.0.1:27018/xilefmini_factura_smoke PORT=3000` (env override only; the real `.env`/`.env.example` values were read but never touched or printed) — a dedicated database kept this fully isolated from any real data. Dropped the smoke database, killed the app process, ran `mongod --dbpath <dir> --shutdown`, and removed the temp dir afterwards.

  | # | Request | Expected | Observed |
  |---|---------|----------|----------|
  | 1 | `POST /facturas` valid (2 items, `descuentoPct`+`descuentoMonto`, `recargo`, `impuesto.porciento`), missing `metodoPago` | 400 (metodoPago required) | 400, `["metodoPago should not be empty","metodoPago must be a string"]` |
  | 2 | same + `metodoPago` | 201, server-computed totals, `FAC-######` id | 201, `numero:1`, `id:"FAC-000001"`, `subtotal:130`, `descuentoTotal:15`, `recargoTotal:2`, `impuesto.importe:11.7`, `total:128.7` (matches the formula: base=117, 117*10/100=11.7) |
  | 3 | `POST` with `id`/`numero`/`total`/`emisor` set | 400 | 400, `["property id should not exist","property numero should not exist","property total should not exist","property emisor should not exist"]` |
  | 4 | `POST` with `items: []` | 400 | 400, `["items must contain at least 1 elements"]` |
  | 5 | `GET /facturas` (no query) | 200, bounded default | 200, array with the 1 existing invoice |
  | 6 | `GET /facturas?page=1&limit=1` | 200, paginated | 200, array with 1 item |
  | 7 | `GET /facturas/FAC-000001` | 200 | 200, full invoice |
  | 8 | `PATCH /facturas/FAC-000001` `{concepto:"venta modificada"}` | 200 | 200, `concepto` updated |
  | 9 | `PATCH /facturas/FAC-000001` `{items:[]}` | 400 | 400, `["property items should not exist"]` |
  | 10 | `PATCH /facturas/FAC-000001/anular` (1st) | 200 | 200, `estado:"anulada"` |
  | 11 | `PATCH /facturas/FAC-000001/anular` (2nd) | 409 | 409, `"La factura FAC-000001 esta anulada y no puede ser anulada"` |
  | 12 | `PATCH /facturas/FAC-000001` `{concepto:"x"}` on the now-anulada invoice | 409 | 409, `"...no puede ser modificada"` |
  | 13 | `DELETE /facturas/FAC-999999` (non-existent) | 404 | 404, `"Factura con ID FAC-999999 no encontrada"` |
  | 14 | 10 concurrent `POST /facturas` (valid, 1 item each) | 10x 201, 10 distinct consecutive `numero`s, no 500s | all 10 returned 201; numeros `2..11`, each distinct and consecutive |

  No bug found by the smoke test — no fix commit was needed for T11.

- Review correction (native review review-6731772c3fa88b4e, finding R4-numero-rollback-livelock, CRITICAL): the T9 counter compensation released the number even when it was already taken, so a duplicate-key failure would hand the same number to every next invoice (creation livelock). Fix: `compensarNumeroTrasFalloDeGuardado` never releases on a duplicate key error or when an invoice with that `numero` is persisted (`numeroPersistido`), only logs; otherwise conditional release as before. Route: inline (one file + spec, understood fix).
  - RED: `npx jest src/modules/factura/factura.service.spec.ts -t "no burned"` -> 3 failed.
  - GREEN: `npx jest src/modules/factura` -> 76 passed (7 suites). `npm run build` clean, `npx eslint` clean, no `any`.

- Live test fix (found testing the running dev server, pre-existing from xilefbackend): an invoice with nit/telefono/email but no direccion failed to auto-create the client, because the Cliente schema requires a non-empty `direccion_cliente` and the service sent `''`; the invoice was saved without `clienteId`. Fix: `FACTURA_CLIENTE_DIRECCION_PLACEHOLDER` ('Sin dirección') when no address is sent. Route: inline (one file + spec + constant).
  - RED: new spec validates the constructed client against the real `ClienteSchema` -> `direccion_cliente: Path 'direccion_cliente' is required`.
  - GREEN: `npx jest src/modules/factura` -> 78 passed. Build/eslint clean, no `any`. Live: POST with nit and no direccion -> `clienteId` set, client stored with 'Sin dirección'.

## Next step
Done. Module README (`src/modules/factura/README.md`) documents the endpoint contract for the frontend, verified live. Merge/push is the user decision.

## Previous next step
All T1-T6 done. Acceptance criteria met: `npx jest src/modules/factura` (60/60), `npm run build`, `npx eslint "src/modules/factura/**/*.ts"` all clean; no `any` type usage in the module. Follow-up for the caller: the create/update contract changed (id/numero/estado/totals removed from CreateFacturaDto; UpdateFacturaDto now only accepts concepto/impreso/direccion/telefono/email) — the frontend does not yet POST invoices (per Constraints), so no consumer is broken today, but this should be communicated before the frontend integrates.
