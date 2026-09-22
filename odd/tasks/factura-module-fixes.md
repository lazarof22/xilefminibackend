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
- Baseline commit: `67f75a8 feat(factura): import factura module from xilefbackend`.
- Contract change: `id`, `numero`, `estado`, `total` removed from create DTO (server-controlled). The frontend currently stores invoices in localStorage and does not POST them yet.

## Totals formula (matches xilefminifrontend FacturacionTab)
- gross = precio * cantidad
- lineDiscount = descuentoMonto + gross * descuentoPct / 100
- item.total = max(0, gross - lineDiscount + recargo)
- subtotal = Σ gross; descuentoTotal = Σ lineDiscount; recargoTotal = Σ recargo
- base = Σ item.total; impuesto.importe = base * porciento / 100 when porciento is set; total = base + importe

## Tasks
- [x] T1 Atomic correlative numbering (counter collection with `$inc`, seeded from max existing `numero`) — fixes #1, part of #8
- [x] T2 Server-side totals, tax calculation, stricter DTO validation, server-controlled fields removed from create — fixes #2, #6, #7, #8
- [ ] T3 Restricted update DTO (only mutable fields), reject edits on annulled invoices, swagger mapped types — fixes #3, #9
- [ ] T4 Local-timezone default date (America/Havana) + `YYYY-MM-DD` validation — fixes #4
- [ ] T5 Deterministic client matching (nit > email > phone), duplicate-key recovery, logged failures — fixes #5
- [ ] T6 Optional pagination on `findAll` (`page`, `limit`) — fixes #10

## Route
Delegated direct: one writer (writer trigger: 2+ non-trivial files).

## Acceptance
- `npx jest src/modules/factura` green, `npm run build` green, `npx eslint src/modules/factura` clean, no `any` in the module.

## Progress / Evidence
- T1 done. Added `schema/factura-contador.schema.ts` (`factura_contadores` collection, `_id: string`, `seq: number`) and registered it in `factura.module.ts`. `FacturaService.siguienteNumero()` now allocates via `findOneAndUpdate({_id:'factura'}, {$inc:{seq:1}}, {upsert:true,new:true}).orFail()`; `id`/`numero` sent by the client are now ignored (server always allocates and builds `FAC-######`). `onModuleInit()` seeds the counter with `updateOne({_id:'factura'}, {$max:{seq:<max numero>}}, {upsert:true})`.
  - RED: `npx jest src/modules/factura` → 4 failed (`Cannot read properties of undefined (reading 'sort')`, `numero` not 7, `onModuleInit is not a function` x2).
  - GREEN: `npx jest src/modules/factura` → 4 passed.
  - `npm run build` → clean.
  - Commit: `eb95549` fix(factura): allocate invoice numbers atomically

- T2 done. Added pure `factura-totales.ts` (`calcularTotales`, `redondear`) implementing the formula from Scope; `FacturaService.create` now always recomputes items/subtotal/descuentoTotal/recargoTotal/impuesto/total server-side and always sets `estado: 'confirmada'`. `CreateFacturaDto`/`ItemFacturaDto` tightened: removed `id`, `numero`, `estado`, `total` (invoice), `subtotal`, `descuentoTotal`, `recargoTotal`, and item `total` (never accepted, recomputed); added `@ArrayMinSize(1)` on items, `@IsPositive()` on `cantidad`, `@Min(0)` on `precio`/`costo`/`descuentoMonto`/`recargo`, `@Min(0)/@Max(100)` on `descuentoPct` and `impuesto.porciento`, `@Min(0)` on `impuesto.importe`. Tax rule: `porciento` set -> importe recomputed (client importe ignored); else client `importe` used if defined (0 valid); else no tax.
  - RED (`factura-totales.spec.ts`): module-not-found (file didn't exist yet).
  - GREEN (`factura-totales.spec.ts`): 8 passed.
  - RED (`create-factura.dto.spec.ts`): 5 failed (server-controlled fields still whitelisted, empty items accepted, impuesto bounds not enforced, item.total still required).
  - GREEN (`create-factura.dto.spec.ts`): 8 passed.
  - RED (`factura.service.spec.ts` T2 describe block): 3 failed (client totals/estado trusted, tax importe not recomputed).
  - GREEN: `npx jest src/modules/factura` -> 23 passed (3 suites).
  - `npm run build` -> clean. `npx eslint "src/modules/factura/**/*.ts"` -> clean (fixed unsafe-mock-typing/prettier issues in the spec files with typed `jest.Mock<T, unknown[]>` generics instead of `any`).
  - Commit: (recorded after commit below)

## Next step
Continue with T3 (restricted update DTO + anular/update conflict handling).
