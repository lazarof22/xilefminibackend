# Fichas normativas (`FichasNormativasModule`)

Read-only catalog (no database) of the normative sheet of each document the
system produces: applicable norm, required fields, numbering rule and
signatures (doc §6.9).

| Method | Route                                 | Roles                             |
| ------ | ------------------------------------- | --------------------------------- |
| `GET`  | `/configuracion/fichas-normativas`        | administrador, gerente, economico |
| `GET`  | `/configuracion/fichas-normativas/:codigo` | idem (404 on unknown code)        |

Each entry: `{ codigo, nombre, norma, camposObligatorios, numeracion: { prefijo,
formato, ejemplo }, firmas, moduloApi }`. The code lookup is case-insensitive.

| Code    | Document                      | Prefix | Module                                  |
| ------- | ----------------------------- | ------ | --------------------------------------- |
| SC-2-04 | Informe de Recepción          | `REC`  | `src/modules/inventario/recepcion`      |
| SC-2-08 | Vale de Entrega o Devolución  | `DEV`  | `src/modules/inventario/devolucion`     |
| SC-2-09 | Transferencia entre almacenes | `TRF`  | `src/modules/inventario/transferencia`  |
| SC-2-16 | Ajuste de Inventario          | `AJU`  | `src/modules/inventario/ajuste-inventario` |
| SC-3-06 | Arqueo de Caja (Res. 12/2007) | none   | `src/modules/inventario/arqueo-caja`    |
| SC-2-13 | Submayor / Kardex             | none   | `src/modules/inventario/kardex`         |

## Where the data comes from

- `numeracion.prefijo`: second argument of `ConsecutivoService.siguiente` in
  each service (numbers look like `REC-000001`). Arqueo (one per turno,
  keyed by `turnoCajaId`) and Kardex (free-text `referencia`) have no own
  sequence, so `prefijo` and `ejemplo` are `null`.
- `camposObligatorios`: required properties of each `create-*.dto.ts`.
- `firmas`: signature/responsible fields of the DTO. The Kardex DTO has none.
- `norma`: only the name already used in each module README/schema comment;
  no legal text is quoted. Update `fichas-normativas.catalogo.ts` when a
  module changes its DTO or prefix (the service spec pins the prefixes).
