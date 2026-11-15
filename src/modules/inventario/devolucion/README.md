# Devolución (Vale de Entrega o Devolución, SC-2-08)

Doc §6.6 / §7.3. Una devolución **siempre referencia su origen** y nunca es una
compra negativa.

| Endpoint | Rol |
| --- | --- |
| `POST /devolucion` | administrador, gerente (§6.9 "Anular factura / venta") |
| `GET /devolucion?formaDevolucionDinero=efectivo&desde=&hasta=` | cualquier usuario autenticado |
| `GET /devolucion/:id` | cualquier usuario autenticado |

## Qué hace

- `tipo: venta` + `origenTipo: venta | factura`: el stock **vuelve a la ubicación
  de la que salió** (`Venta.productos[].ubicaciones`, `Factura.inventarioUbicaciones`)
  con `ExistenciaService.reponerProducto` y se escribe Kardex `devolucion` con
  `referencia = numeroConsecutivo`. Devoluciones sucesivas llenan las
  ubicaciones originales en orden, sin repetir lo ya devuelto.
- `tipo: proveedor` + `origenTipo: registro_compra`: el stock **sale** del lugar
  donde quedó la compra (`descontarProducto`) y se escribe una **salida** de
  Kardex con motivo "Devolución a proveedor: ...". Nunca un movimiento `compra`.
- El servidor calcula el `precioUnitario`, el `importe` y el `montoDevuelto`
  desde el origen; el cliente no envía importes.
- Consecutivo `DEV-000001` con `ConsecutivoService.siguiente('devolucion','DEV')`.
- Antes de activar el modo unificado de existencias mueve `Producto.stock_inicial`
  (igual que venta y factura); después, `Existencia` por ubicación.

## Tope acumulado (a prueba de carreras)

`devolucion_acumulados` guarda, por `(origen, producto)`, lo ya devuelto. Reservar
es **una** escritura condicional (`devuelta <= vendida - cantidad`), así dos
devoluciones simultáneas no pueden devolver entre las dos más de lo vendido. Si
la aplicación falla, el cupo se libera (solo quien marca el vale `fallida` lo libera).
Si el vale ya se creó, el fallo de `registrar` lo pasa `pendiente -> fallida` con una
escritura condicional y solo quien gana esa escritura libera el cupo (si no se pudo
marcar, el vale queda `pendiente` y lo resuelve la recuperación, una sola vez). Si el
vale nunca se creó, se libera directamente. La liberación nunca deja `devuelta` por
debajo de 0.

## Aplicación exactamente una vez

`pendiente -> aplicando -> registrada | fallida`. Solo la llamada que logra el
paso condicional `pendiente -> aplicando` mueve stock; el resto devuelve el vale
tal cual. El documento existe **antes** de mover stock. Si algo falla se deshace el
stock, se borra el Kardex escrito y el vale queda `fallida` (evidencia, no cuenta
en listados ni en el acumulado).

Un corte de proceso deja vales a medias; un cron (cada 5 min, `DevolucionRecuperacionCron`)
los resuelve cuando es inequívoco: un vale `pendiente` de más de 10 min no movió
nada, queda `fallida` y libera su cupo; un vale `aplicando` de más de 10 min con el
Kardex escrito para **cada** producto solo necesita cerrarse y pasa a `registrada`.
Si falta algún asiento no se adivina qué se movió: queda `aplicando` (conserva el
cupo, bloquea cancelar la factura) y el log pide revisar el stock a mano.

## Dinero (doc §7.3) y costuras con las fases 2/3

`formaDevolucionDinero` la deduce el servidor del pago original; si el cliente la
envía y no coincide, se rechaza (400):

| Pago original | Forma |
| --- | --- |
| efectivo cobrado | `efectivo` |
| transferencia | `nota_credito` |
| crédito, o efectivo "cuenta casa" (no se cobró nada) | `descuenta_deuda` |

Costuras que **no** se inventaron aquí:

- **Deuda del cliente.** No existe hoy un saldo de deuda de cliente que decrementar
  (`PagoCredito` solo guarda `monto_pagar`; `Cliente` no tiene saldo). Se persiste
  `formaDevolucionDinero = descuenta_deuda` y `montoDevuelto`; cuando fase 2/3 defina
  el saldo del cliente, debe consumir las devoluciones `registrada` con esa forma.
- **Nota de crédito.** Se persiste `nota_credito` + monto; no se emite el documento.
- **Impuesto del reembolso.** Una venta del checkout guarda el impuesto por línea
  (`subtotal`, `descuentoMonto`, `impuesto`, `total`): el reembolso de una cantidad es la
  parte proporcional del `total` de esa línea, así un producto exento reembolsa su
  precio sin impuesto y uno gravado el suyo con impuesto (devolver todo = `total` de la
  venta, ±0,01). Las ventas anteriores (sin `impuesto` por línea) y las facturas sin
  el indicador `exento` por ítem usan el factor medio del documento.
- **Precio de una venta POS.** `Venta` no guarda el precio unitario: se usa
  `Producto.precio_venta` actual menos el descuento de la línea, más el impuesto de
  la venta repartido proporcional. Si el precio cambió después de la venta, el
  importe puede diferir; la factura sí guarda el total por línea y es exacta.
- **Recepción SC-2-04.** El origen de una devolución a proveedor es hoy `RegistroCompra`;
  cuando exista un origen `recepcion`, añadirlo a `DevolucionOrigenTipo` y a
  `DevolucionOrigenService.resolver`.

## Cuadre de caja (efectivo devuelto)

El cuadre debe restar del efectivo esperado lo devuelto en efectivo:
`GET /devolucion?formaDevolucionDinero=efectivo&desde=<apertura>&hasta=<cierre>`
(solo `registrada`, `moneda` por devolución, `montoDevuelto`). `desde`/`hasta`
aceptan ISO 8601; una fecha sola incluye todo ese día en UTC. Al registrar, el
vale lleva `turnoCaja` si quien lo registra tiene un turno abierto; el cuadre y el
arqueo cuentan ese vale solo en su turno, y los vales sin turno siguen cruzándose
por fecha (`devolucionesEfectivoEnVentana`).

## Pendiente de registro

`DevolucionModule` (`src/modules/inventario/devolucion/devolucion.module.ts`) debe
añadirse a `imports` de `src/app.module.ts`.
