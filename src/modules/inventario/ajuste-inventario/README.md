# Ajuste de inventario SC-2-16 (`AjusteInventario`)

Documento formal de ajuste (doc §6.6): **exige causa, autorización y firma; el
kardex registra el saldo antes y después; no permite ajuste silencioso.**

| Método | Ruta                      | Roles                  |
| ------ | ------------------------- | ---------------------- |
| `POST` | `/ajuste-inventario`      | administrador, economico |
| `GET`  | `/ajuste-inventario`, `/:id` | idem                |

`POST` recibe `{ causa, autorizadoPor, firmadoPor, lineas [{ producto, almacen,
contenedor, ajuste }] }` con `ajuste` positivo (suma) o negativo (resta), nunca
cero. El cliente **no** envía saldos (`saldoAntes`/`saldoDespues` se rechazan):

- `saldoAntes` lo lee el servidor de `Existencia` (producto + almacén +
  contenedor). Antes de activar el modo unificado, de `Producto.stock_inicial`,
  que es lo que el kardex mueve en ese modo.
- `saldoDespues = saldoAntes + ajuste`; si es negativo se rechaza el documento
  entero. Dos líneas de la misma ubicación encadenan el saldo.
- Una disminución exige una causa del nomenclador `causa-disminucion`; un
  aumento acepta una causa libre no vacía.
- Solo administrador y económico (también se comprueba en el servicio).

Cada línea se aplica con `KardexService.create` (`entrada`/`salida`, mismo
flujo del ajuste manual) con `referencia = numeroConsecutivo` (`AJU-000001`) y
el saldo antes/después en el motivo. Si una línea falla, las anteriores se
compensan con movimientos inversos (quedan en el kardex como evidencia) y el
documento no se guarda.
