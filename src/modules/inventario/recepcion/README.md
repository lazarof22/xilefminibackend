# Recepción SC-2-04 (`Recepcion`)

Informe de Recepción (doc §6.2): cabecera normativa + líneas de compra, vinculado
a su **documento de origen** (factura, conduce u otro). El saldo del inventario
se actualiza **al registrar**, no al crear el borrador.

| Método  | Ruta                        | Roles                                   |
| ------- | --------------------------- | --------------------------------------- |
| `POST`  | `/recepcion`                | administrador, gerente, economico       |
| `PATCH` | `/recepcion/:id` (borrador) | idem                                    |
| `POST`  | `/recepcion/:id/registrar`  | idem                                    |
| `GET`   | `/recepcion?estado=`, `/:id` | cualquier usuario autenticado          |

Estados: `borrador` (editable, sin movimiento de stock) -> `registrada`.

`POST` recibe `{ fechaEmision?, almacenReceptor, proveedor, documentoOrigen
{ tipo: factura|conduce|otro, numero, fecha }, transportista?,
responsableComprobacion, lineas [{ producto, contenedor, cantidad,
costo_unitario }] }`. El servidor fija `numeroConsecutivo` (`REC-000001`, vía
`ConsecutivoService`), `entidadReceptora` (código y nombre de `EmpresaDatos`),
el total de cada línea y el `total` del documento, `responsableRecepcion` (el
usuario logueado) e `inventarioAplicado`. El cliente no puede enviar esos campos.

## Registrar

Reclama el documento con una escritura condicional (`borrador` y sin
`inventarioAplicado` -> `registrada` + `inventarioAplicado: true`): un segundo
registro (o uno simultáneo) recibe 409 y el saldo nunca se aplica dos veces.
Por cada línea: `ExistenciaService.reponerProducto` en el almacén receptor y
`RegistroCompraService.registrarLinea`, que crea la compra y el kardex tipo
`compra` con `referencia = numeroConsecutivo` e `importeCUP = total de la línea`.

Si una línea falla se deshace lo escrito (stock, compra y kardex) y el
documento vuelve a `borrador`. Si ni así se puede deshacer, queda
`registrada` (para no aplicar dos veces) y el log indica qué corregir a mano.

`POST /registro-compra` (formulario anterior) sigue igual: no mueve stock porque
el producto ya se creó con su `stock_inicial`.
