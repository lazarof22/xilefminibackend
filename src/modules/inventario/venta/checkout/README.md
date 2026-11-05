# Checkout transaccional — `POST /venta/checkout` (Fase 2)

Una sola petición que **cobra y descuenta**: calcula los totales en el servidor, descuenta el stock,
registra el pago, la venta, el asiento de Kardex y las filas del Reporte Plus, y devuelve el comprobante.
Reemplaza la secuencia de la pantalla (crear pago → crear venta → descontar), que dejaba ventas a medias
si se cortaba entre una llamada y otra.

## Contrato

```
POST /venta/checkout
Authorization: Bearer <token>        (usuario con el módulo punto_venta; el administrador los tiene todos)
Idempotency-Key: <UUID>              (obligatoria; un UUID por OPERACIÓN, no por intento)
```

```jsonc
{
  "clienteId": "…",                       // opcional (obligatorio a crédito)
  "almacenId": "…",                       // opcional, solo con inventario por ubicación
  "ubicacionOrigen": { "contenedorId": "…" },
  "items": [{ "productoId": "…", "cantidad": 2, "descuentoPct": 10 }],
  "pago": { "tipo": "efectivo", "desglose": { "billete1000": 1 } },
  "estimado": { "total": 385 }            // opcional, informativo: NO se usa para cobrar
}
```

El cliente **no envía precios ni totales ni montos**. Cualquier propiedad que no esté en el contrato se rechaza (400).
El precio sale del producto, el impuesto de `config_tributaria` y el efectivo recibido de sumar el desglose.

Respuesta `201`:

```jsonc
{
  "venta": { "_id", "comprobante": "V-000123", "fecha", "items": [...], "subtotal", "descuento", "impuestoPorciento", "impuesto", "total" },
  "pago": { "_id", "tipo", "montoRecibido", "cambio", "esCuentaCasa" },
  "cambio": 615, "comprobante": "V-000123",
  "advertencias": [],                     // p. ej. "Los totales mostrados no coinciden con los del servidor…"
  "idempotencia": { "clave", "estado": "completada", "repetida": false }
}
```

Cabecera de respuesta `Idempotency-Replayed: true|false`.

| Código | Cuándo |
| --- | --- |
| 400 | Datos inválidos, falta la clave, efectivo insuficiente, **stock insuficiente** (nada queda descontado) |
| 401 / 403 | Sin sesión · sin el módulo de punto de venta · descuento por encima del tope del rol |
| 404 | Producto o cliente inexistente |
| 409 | `OPERACION_EN_PROCESO` (la primera ejecución sigue), `OPERACION_EN_REVISION`, `OPERACION_TOMADA` |
| 422 | La clave ya se usó con otros datos (otro carrito, otro usuario) |
| 503 | `VENTA_PENDIENTE`: ya está cobrada y faltan pasos por registrar; se completa sola |

`GET /venta/parametros` devuelve `{ impuestoPorciento, descuentoMaximoPct }` para que la pantalla muestre un estimado fiel.

## Qué garantiza

1. **Totales del servidor.** Misma fórmula que la factura (`calcularTotales`); el impuesto de cada línea se reparte por
   mayor resto, así que las líneas suman exactamente el total.
2. **Sin duplicados.** `Idempotency-Key` se guarda con índice único en `operaciones_idempotentes`. Repetir la petición
   (corte de red, doble clic) devuelve la respuesta guardada; dos peticiones simultáneas con la misma clave ejecutan una sola.
   La misma clave con otro cuerpo → 422 (la huella ignora `estimado`).
3. **Sin sobreventa.** Descuento con actualización condicional (`cantidad >= n`) por línea: dos cajeros con la última unidad
   → una venta y un 400.
4. **Recuperable sin transacciones.** MongoDB autónomo no tiene transacciones; se sustituye por:
   * el **plan** completo (con los `_id` de todo lo que se va a crear) se guarda antes de tocar nada;
   * un **registro de pasos** (solo se añaden asientos): `iniciado` ANTES de cada escritura de stock y `hecho` DESPUÉS;
   * un **punto de no retorno** (`confirmando`): antes se puede revertir, después solo se completa;
   * los pasos de confirmación (pago, venta, Kardex, Reporte Plus) usan `_id` fijados y son **repetibles**;
   * un **arrendamiento**: cada escritura lo renueva; si el proceso muere, vence y la recuperación (al arrancar y cada 15 s)
     toma la operación. El proceso viejo, si despierta, ya no puede escribir (`OPERACION_TOMADA`).

## Qué pasa si el servidor se cae

| Dónde se cortó | La recuperación… |
| --- | --- |
| Antes de guardar el plan | marca `fallida` (no había tocado nada); el cajero reintenta con la misma clave |
| Con stock descontado y anotado (`hecho`), antes de confirmar | **devuelve** ese stock y marca `fallida` |
| Entre "voy a descontar" y "descontado" (`iniciado` sin `hecho`) | **no toca el stock a ciegas**: pasa a `revision` |
| Mientras devolvía (`revirtiendo` sin `revertido`) | pasa a `revision` (nunca devuelve dos veces) |
| Tras confirmar (pago/venta/Kardex/reporte a medias) | **completa** lo que falte con los mismos `_id`, sin duplicar |

Más de 5 intentos de recuperación sin éxito también pasan a `revision`.

### Operaciones en revisión

```js
db.operaciones_idempotentes.find({ estado: 'revision' }, { clave: 1, motivoRevision: 1, pasos: 1, plan: 1 })
```

`motivoRevision` dice qué línea es dudosa. Compare con el Kardex y el stock (la conciliación de existencias de la Fase 1
muestra cualquier desfase), corrija a mano y no reenvíe esa clave: responde `409 OPERACION_EN_REVISION`.

## Configuración

* **Impuesto sobre ventas (%)** — por defecto 0 (el punto de venta no cobraba impuesto):
  `db.config_tributaria.updateOne({ clave: 'ventas' }, { $set: { impuestoVentasPorciento: 10 } }, { upsert: true })`
  Un valor fuera de 0–100 detiene las ventas con un 500 claro, no se corrige en silencio.
* **Descuento máximo por rol** — `checkout-politica.ts` (`DESCUENTO_MAXIMO_POR_ROL`). Hoy todos los roles llegan a 100 %
  (como antes); para limitar a un rol, baje su número (por ejemplo `[UsuarioRol.CAJERO]: 10`).

## Límites conocidos

* Un corte exacto entre "voy a descontar" y "descontado" no se puede resolver solo: va a `revision` (ver arriba).
* Si el servidor cae tras asignar el número de comprobante y antes de confirmar, ese número queda sin usar (hueco en la numeración).
* Con un conjunto de réplicas se podrían usar transacciones; este diseño no las necesita y funciona igual en MongoDB autónomo.
* Fase 3 (pendiente): denominaciones y cambio por moneda, CI/NIT, validación de prefijos bancarios.

## Pruebas

`checkout-totales.spec.ts` (totales y política) · `checkout.service.spec.ts` (flujo, idempotencia, última unidad, medios de pago) ·
`checkout-recuperacion.spec.ts` (caída en cada paso, proceso zombi) · `operacion-idempotente.service.spec.ts` ·
`pago-checkout.spec.ts`. El entorno en memoria (`checkout-entorno-spec.ts`) comparte un interruptor que simula la caída del proceso.
