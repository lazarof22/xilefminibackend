# Módulo Factura — Contrato de la API

Guía para conectar el frontend con los endpoints de `/facturas`: qué envía cada uno, qué devuelve y qué errores puede dar.

> **Regla de oro:** el frontend envía **qué se vendió y a quién**. El servidor decide **el número, el id, el estado, los totales, el impuesto, el emisor y quién factura (`facturadoPor`)**. Si el frontend manda alguno de esos campos, la petición se rechaza con `400`.

---

## Resumen de endpoints

| Método | Ruta | Para qué | Rol requerido | Éxito | Errores |
|---|---|---|---|---|---|
| `POST` | `/facturas` | Emitir una factura (nace en `edicion`) | `administrador`, `gerente`, `facturador` | `201` | `400`, `401`, `403`, `404`, `422` |
| `GET` | `/facturas` | Listar facturas (paginado) | cualquier usuario autenticado | `200` | `400`, `401` |
| `GET` | `/facturas/:id` | Ver una factura | cualquier usuario autenticado | `200` | `401`, `404` |
| `PATCH` | `/facturas/:id` | Editar la factura (**qué campos acepta depende del estado actual**, ver abajo) | `administrador`, `gerente`, `facturador` | `200` | `400`, `401`, `403`, `404`, `409` |
| `PATCH` | `/facturas/:id/terminar` | `edicion` → `terminada` | `administrador`, `gerente`, `facturador` | `200` | `401`, `403`, `404`, `409` |
| `PATCH` | `/facturas/:id/editar` | `terminada` → `edicion` | `administrador`, `gerente`, `facturador` | `200` | `401`, `403`, `404`, `409` |
| `PATCH` | `/facturas/:id/confirmar` | `terminada` → `confirmada` | `administrador`, `gerente`, `facturador` | `200` | `401`, `403`, `404`, `409` |
| `PATCH` | `/facturas/:id/cancelar` | `confirmada` → `cancelada` | `administrador`, `gerente`, `facturador` | `200` | `401`, `403`, `404`, `409` |
| `PATCH` | `/facturas/:id/anular` | `edicion`/`terminada` → `anulada` | `administrador`, `gerente`, `facturador` | `200` | `401`, `403`, `404`, `409` |
| `DELETE` | `/facturas/:id` | Anular (alias del anterior, **no borra**) | `administrador`, `gerente`, `facturador` | `200` | `401`, `403`, `404`, `409` |

- `:id` es el identificador legible de la factura (por ejemplo `FAC-000005`), **no** el `_id` de Mongo.
- Todas las peticiones con cuerpo usan `Content-Type: application/json`.

### Autenticación y roles (T4)

Todas las rutas de `/facturas` requieren un JWT válido (`Authorization: Bearer <token>`), el mismo emitido por `/auth/login`. Sin token, o con uno inválido/expirado, el servidor responde `401`.

Además, las rutas que **escriben** (`POST`, `PATCH`, `DELETE`) exigen que el usuario autenticado tenga uno de estos roles: `administrador`, `gerente` o `facturador`. Un usuario autenticado con otro rol (por ejemplo `cajero` o `economico`) recibe `403` al intentar usarlas.

Las rutas de **lectura** (`GET /facturas`, `GET /facturas/:id`) solo requieren estar autenticado: cualquier rol vale.

| Error | Cuándo |
|---|---|
| `401` | No se envió token, el token es inválido/expiró, o el usuario del token ya no existe (ver [`facturadoPor`](#facturado-por)). |
| `403` | El usuario autenticado no tiene un rol permitido para esa ruta. |

---

## Estados y transiciones de una factura (T6a/T6b)

Toda factura tiene un `estado`, uno de `edicion`, `terminada`, `confirmada`, `cancelada`, `anulada`. Nace siempre en `edicion`.

| Estado | Significado | Qué se puede editar (`PATCH /facturas/:id`) |
|---|---|---|
| `edicion` | Estado inicial. No hay movimiento de inventario. | **Todos** los campos de negocio (ver [tabla completa](#patch-facturasid--editar-una-factura)); items/impuesto/almacén/cliente se revalidan y recalculan server-side. |
| `terminada` | Cerrada para el flujo normal de edición. Puede volver a `edicion`, confirmarse o anularse. Todavía no hay movimiento de inventario. | Solo `fecha`, `talonario` e `impreso`. |
| `confirmada` | Factura en firme. Descuenta inventario (ver [Movimientos de inventario](#movimientos-de-inventario-al-confirmar--cancelar-t7)). | Solo `impreso` (marcarla como impresa no cambia nada fiscal). |
| `cancelada` | Reversa de una factura `confirmada`: devuelve al inventario lo que se descontó al confirmar. Estado terminal. | Solo `impreso`. |
| `anulada` | Estado terminal. Su `numero`/`id` nunca se reutiliza: el contador correlativo nunca se decrementa al anular, así que ninguna factura futura puede recibir ese mismo código. | Nada: una factura anulada es de solo lectura. |

> Enviar en el `PATCH` un campo que el estado actual no permite modificar (por ejemplo `concepto` en `terminada`, o cualquier campo en `anulada`) devuelve `409`, nombrando el estado y los campos rechazados (ver [ejemplos](#formato-de-los-errores)). Un `PATCH` sin ningún campo no es error: devuelve la factura sin cambios.

**Migración de facturas legadas (`ajustada`)**: las facturas que antes de este ciclo de estados tenían `estado: "ajustada"` se migran una sola vez a `confirmada` (el estado válido más cercano) al iniciar el servidor. Para no perder ese dato, guardan además `estadoLegado: "ajustada"`. Este campo es puramente informativo: no afecta transiciones ni permisos, y nunca aparece en una factura que nunca fue `ajustada`.

**Transiciones permitidas** (cualquier otra combinación devuelve `409`):

```
edicion    -> terminada | anulada
terminada  -> edicion | confirmada | anulada
confirmada -> cancelada
cancelada  -> (terminal, sin salida)
anulada    -> (terminal, sin salida)
```

Cada transición es una única petición `PATCH` sin cuerpo:

| Transición | Endpoint |
|---|---|
| `edicion` → `terminada` | `PATCH /facturas/:id/terminar` |
| `terminada` → `edicion` | `PATCH /facturas/:id/editar` |
| `terminada` → `confirmada` | `PATCH /facturas/:id/confirmar` |
| `confirmada` → `cancelada` | `PATCH /facturas/:id/cancelar` |
| `edicion`/`terminada` → `anulada` | `PATCH /facturas/:id/anular` (o `DELETE /facturas/:id`, alias) |

**Respuesta `200`:** la `Factura` con el nuevo `estado`.
**Errores:** `404` (no existe), `409` (la factura no está en un estado desde el que se pueda hacer esa transición; el mensaje nombra el estado actual y el estado destino intentado).

```http
PATCH /facturas/FAC-000005/terminar
Authorization: Bearer <token>
```

```json
{ "statusCode": 409, "error": "Conflict", "message": "La factura FAC-000005 esta en estado \"confirmada\" y no puede pasar a \"terminada\"" }
```

### Movimientos de inventario al confirmar / cancelar (T7)

`terminar`, `editar` y `anular` nunca tocan el inventario. Solo lo hacen:

- **`confirmar`**: descuenta de `Producto.stock_inicial` (el stock vivo, el mismo que usa Ventas) la cantidad de cada producto de la factura (si un producto aparece en varios items, se suman) y registra un movimiento Kardex `venta` por producto, con `motivo: "Factura FAC-000012 confirmada"`, `referencia: "FAC-000012"` y el stock resultante. La factura queda con `inventarioAplicado: true`.
- **`cancelar`**: si la factura tiene `inventarioAplicado: true`, devuelve esas cantidades al stock, registra un Kardex `devolucion` por producto (`motivo: "Factura FAC-000012 cancelada"`) y marca `inventarioRevertido: true`. Un producto que ya no existe se omite (queda en el log del servidor) y se sigue con el resto.

Si algún producto no puede descontarse (stock insuficiente, no existe, está inactivo o pertenece a otro almacén que el de la factura), se revierten los descuentos ya hechos, la factura vuelve a `terminada` y la respuesta es `409`. El mensaje se arma leyendo el producto **después** del fallo: dice si el producto no existe, si está inactivo, si ya no pertenece al almacén de la factura (se movió), o el stock disponible frente al solicitado; si al releerlo el stock ya alcanza (otro proceso lo cambió), dice que el stock cambió durante la confirmación y pide reintentar:

```json
{ "statusCode": 409, "error": "Conflict", "message": "No se puede confirmar la factura FAC-000012: stock insuficiente para el producto \"Tornillo\" (665f1c...): disponible 1, solicitado 3" }
```

Dos `confirmar` simultáneos sobre la misma factura: solo uno la reclama; el otro recibe el `409` de transición inválida, así que el stock nunca se descuenta dos veces.

**Marcador `inventarioEnProceso` (T7b):** mientras `confirmar` o `cancelar` mueven stock, la factura lleva `inventarioEnProceso: true`; se quita en la misma escritura condicional que termina la operación (éxito, o vuelta a `terminada` si la confirmación falla). Un `cancelar` que llega mientras una confirmación todavía está descontando stock **no** puede reclamar la factura y recibe `409` `"La factura FAC-000012 se está confirmando; reintente"`, sin tocar el stock. Así nunca se devuelve stock que todavía no se descontó.

**Qué garantiza `terminada` tras un `confirmar` fallido:** que la factura no quedó confirmada y que se intentó compensar cada descuento que se sabe aplicado. No garantiza que el stock quedó exacto si alguna escritura fue ambigua o alguna compensación falló: esos casos quedan en el log (ver abajo).

**Facturas legadas:** una factura que ya estaba `confirmada` antes de esta funcionalidad no tiene `inventarioAplicado` (nunca descontó stock), así que al cancelarla **no** se toca el stock ni el Kardex.

**Limitaciones conocidas (sin transacciones):** MongoDB corre sin replica set, así que no hay transacciones multi-documento. Cada escritura de stock es atómica y condicional, y los fallos se compensan, pero:

- **Caída del proceso a mitad de camino:** puede quedar parte del stock descontado (o restaurado) y la factura con `inventarioEnProceso: true`. Se reconoce porque la factura tiene el marcador puesto y no hay una petición en curso (una confirmación normal dura milisegundos); mientras siga puesto, `cancelar` responde siempre "se está confirmando; reintente". Arreglo manual: comparar el stock con el Kardex `venta`/`devolucion` de esa `referencia`, corregir el stock y quitar el campo (`$unset: { inventarioEnProceso: 1 }`) o devolver la factura a `terminada`.
- **Escritura ambigua:** si el descuento de un producto lanza un error (timeout, red), no se sabe si se aplicó. Ese producto **no** se compensa (sumarle a ciegas podría crear stock); se compensan solo los que se sabe aplicados, la confirmación falla con el error original y el log dice `Rebaja de stock ambigua (factura ..., producto ..., cantidad ...): pudo aplicarse o no, conciliar a mano`.
- **Reversión fallida:** si tras un fallo de stock la factura no puede volver a `terminada`, se responde con el error de stock original (nunca con el de la reversión) y el log dice `No se pudo revertir la factura a terminada ...` o `La factura quedó confirmada sin rebaja de stock ...`, con la factura, la `revision` y el error original.
- **Marcador sin quitar:** si la escritura final falla después de mover el stock, el log dice `La factura FAC-... (confirmada|cancelada, revision N) quedó con inventarioEnProceso; ...`. El stock ya es correcto; solo hay que quitar el marcador.
- **Kardex:** el stock es la fuente de verdad; si el Kardex no se puede escribir después de mover el stock, el stock **no** se revierte. Las filas se insertan sin orden (`ordered: false`), así que una fila inválida no impide las demás, y el log lista exactamente las filas que faltan (`N de M filas`). El Kardex acepta cantidades fraccionarias (mayores que 0), igual que los items.
- **Stock en 0:** un producto que se queda sin stock no pasa a inactivo (igual que en Ventas).

En todos los casos el log de error del servidor nombra la factura, el producto y la cantidad a corregir a mano.

---

## El objeto `Factura` (lo que devuelve el servidor)

Todos los endpoints que devuelven una factura usan esta forma:

```json
{
  "_id": "6ab335564ed6659d14298a69",
  "id": "FAC-000005",
  "numero": 5,
  "fecha": "2026-09-22",
  "cliente": "Venta al público",
  "nit": "",
  "direccion": "",
  "telefono": "",
  "email": "",
  "moneda": "CUP",
  "concepto": "Venta mayorista",
  "clienteId": "6ab3390ec5a9357a2d833cbc",
  "almacenId": "6ab335564ed6659d14298a70",
  "almacenCodigo": "ALM-001",
  "emisor": {
    "nombre": "Empresa Dev SA",
    "nit": "NIT-EMPRESA-DEV",
    "direccion": "Calle Dev 1",
    "telefono": "555000",
    "email": "dev@empresa.test",
    "ciudad": "La Habana",
    "pais": "Cuba"
  },
  "impuesto": { "tipo": "IVA", "porciento": 10, "importe": 22.85 },
  "metodoPago": "efectivo",
  "despachadoPor": {
    "nombre": "Pedro Gómez",
    "ci": "88070112345",
    "fecha": "2026-09-22"
  },
  "transportadoPor": {
    "nombre": "María Suárez",
    "ci": "91020556789",
    "fecha": "2026-09-22"
  },
  "recibidoPor": {
    "nombre": "Ana Pérez",
    "ci": "12345678901",
    "fecha": "2026-09-23"
  },
  "facturadoPor": {
    "empleadoId": "6ab3390ec5a9357a2d833c00",
    "nombre": "Carlos Ruiz",
    "ci": "80010112345",
    "fecha": "2026-09-24"
  },
  "items": [
    {
      "id": "i1",
      "productoId": "p1",
      "productoNombre": "Arroz",
      "cantidad": 2,
      "precio": 100,
      "costo": 60,
      "descuentoPct": 10,
      "descuentoMonto": 5,
      "recargo": 3,
      "total": 178
    }
  ],
  "subtotal": 250.5,
  "descuentoTotal": 25,
  "recargoTotal": 3,
  "total": 251.35,
  "estado": "edicion",
  "revision": 2,
  "talonario": "T-001",
  "tipo": "factura_normal",
  "impreso": false,
  "createdAt": "2026-09-23T02:11:34.262Z",
  "updatedAt": "2026-09-23T02:13:16.406Z"
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` | `FAC-` + número de 6 dígitos. Lo genera el servidor. |
| `numero` | `number` | Correlativo único y sin repetidos. Lo genera el servidor. |
| `fecha` | `string` | `YYYY-MM-DD`. Si no se envía, es la fecha de hoy en La Habana. |
| `cliente` | `string` | Nombre del comprador. Si no se envía, vale `"Venta al público"`. |
| `nit`, `direccion`, `telefono`, `email` | `string` | Datos del comprador. Vacíos (`""`) si no se enviaron. Un `"—"` enviado se guarda como `""`. |
| `moneda` | `string` | `"CUP"` por defecto. |
| `concepto` | `string` | **Opcional:** no aparece si nunca se cargó. |
| `clienteId` | `string` | **Opcional:** solo aparece si se envió `nit`, `telefono` o `email` (ver [Clientes](#clientes)). |
| `almacenId` | `string` | El `_id` del almacén desde el que se factura. Lo valida el servidor a partir del `almacenId` enviado en el `POST`. |
| `almacenCodigo` | `string` | El código del almacén, tomado del almacén en el momento de emitir (no se actualiza si el código del almacén cambia después). |
| `emisor` | `object` | **Opcional:** se toma de los datos de la empresa (`/empresa`). No aparece si la empresa no está configurada. `ciudad` y `pais` son opcionales dentro de `emisor` (ver más abajo). |
| `impuesto` | `object` | **Opcional:** `importe` siempre lo calcula el servidor cuando hay `porciento`. |
| `metodoPago` | `string` | Uno de `"efectivo"`, `"transferencia"`, `"credito"` (enum `TipoPago`, ver más abajo). |
| `despachadoPor`, `transportadoPor`, `recibidoPor` | `object` | **Opcionales:** ver [Participantes](#participantes-despachado-por--transportado-por--recibido-por). No incluyen firma (fuera de alcance). |
| `facturadoPor` | `object` | El usuario (`Facturador`) autenticado que emitió la factura. Lo toma el servidor del token JWT, nunca del cuerpo de la petición (ver [Facturado por](#facturado-por)). Ausente solo en facturas emitidas antes de este campo (legado). |
| `items[].total` | `number` | Lo calcula el servidor (ver [Cómo se calculan los totales](#cómo-se-calculan-los-totales)). |
| `subtotal`, `descuentoTotal`, `recargoTotal`, `total` | `number` | Los calcula el servidor. Redondeados a 2 decimales. |
| `estado` | `string` | `"edicion"`, `"terminada"`, `"confirmada"`, `"cancelada"` o `"anulada"`. Toda factura nueva nace `"edicion"` (ver [Estados y transiciones](#estados-y-transiciones-de-una-factura-t6at6b)). |
| `estadoLegado` | `string` | **Opcional:** solo `"ajustada"`, y solo presente en una factura migrada desde ese estado legado (ver [Estados y transiciones](#estados-y-transiciones-de-una-factura-t6at6b)). Ausente en cualquier otra factura. |
| `revision` | `number` | **Server-controlado, nunca en el `POST`/`PATCH`:** contador de concurrencia optimista (T6c). Se incrementa en cada `PATCH /facturas/:id` y en cada transición de estado. Ausente solo en una factura legada, de antes de que este campo existiera. Ver [Concurrencia al editar](#concurrencia-al-editar-revision-t6c). |
| `inventarioAplicado` | `boolean` | **Server-controlado:** `true` solo si al confirmar esta factura se descontó el stock (T7). Ausente en facturas legadas confirmadas antes de esta funcionalidad. |
| `inventarioRevertido` | `boolean` | **Server-controlado:** `true` cuando al cancelar se devolvió ese stock (T7). |
| `inventarioEnProceso` | `boolean` | **Server-controlado:** `true` solo mientras `confirmar`/`cancelar` mueven stock (T7b). Si queda puesto sin una petición en curso, ver [Limitaciones conocidas](#movimientos-de-inventario-al-confirmar--cancelar-t7). |
| `talonario` | `string` | **Opcional:** referencia libre al talonario/recibo asociado. Hasta 50 caracteres. |
| `tipo` | `string` | `"factura_normal"` (por defecto) o `"ajuste"`. |
| `impreso` | `boolean` | `false` por defecto. |

**`emisor.ciudad` / `emisor.pais`**

Ambos son opcionales y se toman de los datos de la empresa (`/empresa`):

- `ciudad` es una copia directa de `EmpresaDatos.ciudad` (texto libre).
- `pais` es el **nombre** del país (`Pais.nombrePais`), resuelto server-side a partir del `EmpresaDatos.pais` configurado (que internamente es una referencia, no un texto). Si la empresa no tiene país configurado, o el país referenciado ya no existe, `pais` no aparece en `emisor`.

### Participantes: "Despachado por" / "Transportado por" / "Recibido por"

Cada uno, cuando está presente, es un objeto con esta forma (sin firma, excluida a pedido del cliente):

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | `string` | Nombre completo. |
| `ci` | `string` | Carné de identidad **u otro documento** (hasta 20 caracteres; no se exige el formato de 11 dígitos porque un transportista o receptor puede ser extranjero). |
| `fecha` | `string` | `YYYY-MM-DD`, misma validación que la `fecha` de la factura. |

Los tres son opcionales tanto al crear (`POST`) como al editar (`PATCH`, ver [Editar datos no fiscales](#patch-facturasid--editar-datos-no-fiscales)).

> Los campos opcionales **no vienen en el JSON** cuando no tienen valor; no llegan como `null`. En TypeScript tipalos como `campo?: tipo`.

### Facturado por

`facturadoPor` es quién emitió la factura: el usuario `Facturador` (o `administrador`/`gerente`) que estaba autenticado en ese momento. **No se envía en el `POST`**, el servidor lo calcula a partir del token JWT:

| Campo | Tipo | Notas |
|---|---|---|
| `empleadoId` | `string` | `_id` de Mongo del usuario autenticado. |
| `nombre` | `string` | `nombre_empleado` del usuario en el momento de facturar (una foto; si luego se renombra el usuario, la factura conserva el nombre original). |
| `ci` | `string` | `ci_empleado` del usuario, misma foto. |
| `fecha` | `string` | `YYYY-MM-DD`, la fecha de hoy en `America/Havana` (no la `fecha` de la factura, que puede ser distinta si se envía manualmente). |

Si el token es válido pero el usuario ya no existe (por ejemplo, se borró la cuenta después de haber iniciado sesión), el `POST` responde `401` y **no se emite la factura** (no se consume ningún número correlativo).

`facturadoPor` está ausente solo en facturas emitidas antes de que este campo existiera (legado); toda factura nueva siempre lo trae.

---

## `POST /facturas` — Emitir una factura

### Cuerpo

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `metodoPago` | `string` | **Sí** | Uno de `"efectivo"`, `"transferencia"`, `"credito"` (ver [Método de pago](#método-de-pago)). |
| `almacenId` | `string` | **Sí** | `_id` de Mongo de un almacén existente que tenga `codigo` configurado. |
| `items` | `ItemFactura[]` | **Sí** | Al menos 1 item. |
| `fecha` | `string` | No | `YYYY-MM-DD` y fecha real (`2026-02-30` se rechaza). |
| `cliente` | `string` | No | Nombre del comprador. |
| `nit` | `string` | No | NIT del comprador. |
| `direccion` | `string` | No | |
| `telefono` | `string` | No | |
| `email` | `string` | No | |
| `moneda` | `string` | No | Por defecto `"CUP"`. |
| `concepto` | `string` | No | |
| `impuesto` | `Impuesto` | No | Ver abajo. |
| `tipo` | `string` | No | `"factura_normal"` o `"ajuste"`. |
| `impreso` | `boolean` | No | |
| `despachadoPor` | `ParticipanteFactura` | No | Ver [Participantes](#participantes-despachado-por--transportado-por--recibido-por). |
| `transportadoPor` | `ParticipanteFactura` | No | Ídem. |
| `recibidoPor` | `ParticipanteFactura` | No | Ídem. |
| `talonario` | `string` | No | Referencia libre al talonario/recibo. No vacío tras `trim`, máximo 50 caracteres. |

> `despachadoPor`, `transportadoPor`, `recibidoPor` y `talonario` aceptan quedar **ausentes**, pero rechazan `null` explícito con `400` (no es lo mismo "no lo envié" que "bórralo con null").

**Método de pago**

`metodoPago` valida contra el enum `TipoPago`, los mismos tres métodos que ya maneja el módulo `pago`:

| Valor | Significado |
|---|---|
| `"efectivo"` | Pago en efectivo. |
| `"transferencia"` | Pago por transferencia bancaria. |
| `"credito"` | Pago a crédito. |

Cualquier otro valor se rechaza con `400`. Una factura vieja guardada con un valor fuera del enum sigue cargando sin problema (el `GET` no valida); solo no puede volver a guardarse con ese mismo valor fuera de enum porque `metodoPago` no es editable vía `PATCH`.

**`ParticipanteFactura`** (`despachadoPor` / `transportadoPor` / `recibidoPor`)

| Campo | Tipo | Obligatorio (si se envía el objeto) | Reglas |
|---|---|---|---|
| `nombre` | `string` | **Sí** | No vacío (se recorta con `trim`), máximo 200 caracteres. |
| `ci` | `string` | **Sí** | No vacío (se recorta con `trim`), máximo 20 caracteres. No se exige formato de 11 dígitos: puede ser un documento extranjero. |
| `fecha` | `string` | **Sí** | `YYYY-MM-DD` y fecha real, misma validación que la `fecha` de la factura. |

**`ItemFactura`**

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `id` | `string` | **Sí** | Identificador local del item (lo genera el frontend). |
| `productoId` | `string` | **Sí** | `_id` de Mongo de un producto existente. Si ese producto tiene un almacén asignado, debe coincidir con el `almacenId` de la factura. |
| `productoNombre` | `string` | **Sí** | |
| `unidadMedida` | `string` | No | |
| `cantidad` | `number` | **Sí** | Mayor que 0. |
| `precio` | `number` | **Sí** | Precio unitario, mayor o igual a 0. |
| `costo` | `number` | **Sí** | Costo unitario, mayor o igual a 0. |
| `descuentoPct` | `number` | **Sí** | Entre 0 y 100. Usar `0` si no hay. |
| `descuentoMonto` | `number` | **Sí** | Mayor o igual a 0. Usar `0` si no hay. |
| `recargo` | `number` | **Sí** | Mayor o igual a 0. Usar `0` si no hay. |

**`Impuesto`**

| Campo | Tipo | Reglas |
|---|---|---|
| `tipo` | `string` | Por ejemplo `"IVA"`. |
| `porciento` | `number` | Entre 0 y 100. Si viene, el servidor **calcula** el `importe`. |
| `importe` | `number` | Mayor o igual a 0. Solo se usa si **no** viene `porciento`. |

### Campos prohibidos

El servidor responde `400` (`property X should not exist`) si el cuerpo trae alguno de estos campos:

`id`, `numero`, `estado`, `subtotal`, `descuentoTotal`, `recargoTotal`, `total`, `emisor`, `almacenCodigo`, `items[].total`, `facturadoPor`

### Errores del almacén y los productos

| Caso | Código | Mensaje |
|---|---|---|
| `almacenId` no es un `_id` de Mongo válido | `400` | Error de validación (`almacenId must be a mongodb id`) |
| El almacén no existe | `404` | `Almacén con ID <almacenId> no encontrado` |
| El almacén existe pero no tiene `codigo` configurado | `422` | `El almacén "<nombre>" no tiene código configurado` |
| Algún `items[].productoId` no es un `_id` de Mongo válido | `400` | Error de validación (`productoId must be a mongodb id`) |
| Algún `items[].productoId` no corresponde a un producto existente | `400` | `El producto <productoId> no existe` |
| Un producto tiene almacén asignado y no coincide con `almacenId` | `400` | `El producto <productoId> no pertenece al almacén seleccionado` |

> El `422` de "no tiene código configurado" es lo esperado en un almacén creado antes de este contrato (todavía sin `codigo`): para poder facturar desde él, primero configurá su `codigo` con `PATCH /almacen/:id`.

### Ejemplo

```http
POST /facturas
Content-Type: application/json
Authorization: Bearer <token>

{
  "metodoPago": "efectivo",
  "almacenId": "6ab335564ed6659d14298a70",
  "cliente": "Ana Pérez",
  "nit": "12345678901",
  "direccion": "Calle 1 #23",
  "impuesto": { "tipo": "IVA", "porciento": 10 },
  "recibidoPor": {
    "nombre": "Ana Pérez",
    "ci": "12345678901",
    "fecha": "2026-09-23"
  },
  "items": [
    {
      "id": "i1",
      "productoId": "6ab335564ed6659d14298a71",
      "productoNombre": "Arroz",
      "cantidad": 2,
      "precio": 100,
      "costo": 60,
      "descuentoPct": 10,
      "descuentoMonto": 5,
      "recargo": 3
    }
  ]
}
```

**Respuesta `201`:** el objeto [`Factura`](#el-objeto-factura-lo-que-devuelve-el-servidor) completo, con `id`, `numero`, totales, `almacenCodigo` y `emisor` ya calculados. **Usá esta respuesta para imprimir la factura**, no los totales que calculó el frontend.

---

## `GET /facturas` — Listar facturas

### Query params

| Param | Tipo | Por defecto | Reglas |
|---|---|---|---|
| `page` | `number` | `1` | Entero, mínimo 1. |
| `limit` | `number` | `50` | Entero, entre 1 y 500. |

**Respuesta `200`:** un array `Factura[]` ordenado por `numero` de mayor a menor (las más nuevas primero). Incluye las anuladas.

```http
GET /facturas?page=2&limit=20
```

> La respuesta es solo el array; no trae el total de registros. Para saber si hay más páginas, pedí la siguiente: si viene con menos de `limit` elementos, es la última.

---

## `GET /facturas/:id` — Ver una factura

```http
GET /facturas/FAC-000005
```

**Respuesta `200`:** el objeto [`Factura`](#el-objeto-factura-lo-que-devuelve-el-servidor).
**Error `404`:** la factura no existe.

---

## `PATCH /facturas/:id` — Editar una factura

Qué campos acepta un `PATCH` depende del **estado actual** de la factura (ver [Estados y transiciones](#estados-y-transiciones-de-una-factura-t6at6b)); enviar un campo que el estado actual no permite devuelve `409` (no `400`: la petición es válida, lo que no es válido es aplicarla ahora). Un `PATCH` sin ningún campo no es error: la factura se devuelve sin cambios.

### Matriz de edición por estado

| Campo | `edicion` | `terminada` | `confirmada` / `cancelada` | `anulada` |
|---|:---:|:---:|:---:|:---:|
| `fecha` | ✅ | ✅ | ❌ | ❌ |
| `talonario` | ✅ | ✅ | ❌ | ❌ |
| `impreso` | ✅ | ✅ | ✅ | ❌ |
| `cliente`, `nit`, `direccion`, `telefono`, `email` | ✅ | ❌ | ❌ | ❌ |
| `moneda`, `concepto` | ✅ | ❌ | ❌ | ❌ |
| `almacenId` | ✅ | ❌ | ❌ | ❌ |
| `impuesto`, `metodoPago`, `items` | ✅ | ❌ | ❌ | ❌ |
| `despachadoPor`, `transportadoPor`, `recibidoPor` | ✅ | ❌ | ❌ | ❌ |

`tipo`, y todos los campos server-controlados (`id`, `numero`, `estado`, totales, `emisor`, `facturadoPor`, `almacenCodigo`, `clienteId`) nunca son editables vía `PATCH`, en ningún estado (el pipe global los rechaza con `400` por no estar en la lista blanca).

### Qué pasa al editar en `edicion`

Editar en `edicion` no es solo "guardar el campo": algunos cambios disparan la misma validación que corre `POST /facturas`, para que la factura editada quede tan consistente como una recién creada:

| Si cambia... | El servidor... |
|---|---|
| `items` y/o `impuesto` | Recalcula **todos** los totales (`subtotal`, `descuentoTotal`, `recargoTotal`, `impuesto.importe`, `total`) con la misma fórmula que `POST` (ver [Cómo se calculan los totales](#cómo-se-calculan-los-totales)). Si solo cambia `impuesto`, usa los `items` ya guardados; si solo cambian `items`, usa el `impuesto` ya guardado. |
| `items` y/o `almacenId` | Vuelve a validar el almacén (404/422) y que cada item pertenezca a él (400), igual que `POST`, y refresca `almacenCodigo`. |
| `cliente`, `nit`, `direccion`, `telefono` y/o `email` | Vuelve a vincular el cliente con la misma prioridad que `POST` (`nit` → `email` → `telefono`, crea uno nuevo si no hay coincidencia) y refresca `clienteId`. Los campos que no se envían mantienen su valor actual (no hace falta reenviar todo el bloque del comprador para cambiar solo uno). |
| `fecha` | Se valida igual que en `POST` (`YYYY-MM-DD`, fecha de calendario real). |

> Si una factura no tiene `almacenId` (factura legada, de antes de que este campo existiera) y se le cambian los `items` sin enviar `almacenId`, el servidor responde `422`: no hay almacén contra el cual validar los productos.

### Ejemplos

```http
PATCH /facturas/FAC-000005
Content-Type: application/json
Authorization: Bearer <token>

{ "impreso": true }
```

**Respuesta `200`:** la `Factura` actualizada.

```http
PATCH /facturas/FAC-000005
Content-Type: application/json
Authorization: Bearer <token>

{ "concepto": "Venta mayorista corregida" }
```

Si `FAC-000005` está `terminada`, la respuesta es `409`:

```json
{ "statusCode": 409, "error": "Conflict", "message": "La factura FAC-000005 esta en estado \"terminada\": no se puede modificar concepto" }
```

**Errores:** `400` (campo no whitelisteado, o dato inválido), `404` (no existe), `409` (el estado actual no permite modificar alguno de los campos enviados — el mensaje los nombra todos; o la factura cambió mientras se editaba, ver abajo).

> Uso típico: después de imprimir, enviar `{ "impreso": true }` (funciona en cualquier estado salvo `anulada`).

### Concurrencia al editar (`revision`, T6c)

Cada `PATCH /facturas/:id` valida internamente contra el `revision` que leyó al empezar (además del `estado`), no solo contra el `estado`: si dos ediciones concurrentes leen la misma factura y ambas intentan escribir, solo la primera tiene éxito. La segunda recibe `409`:

```json
{ "statusCode": 409, "error": "Conflict", "message": "La factura FAC-000005 cambio mientras se editaba; reintente" }
```

Esto puede pasar aunque el `estado` no haya cambiado (por ejemplo, dos usuarios editando `concepto` en `edicion` al mismo tiempo): antes de esto, esa segunda escritura se aplicaba igual y pisaba silenciosamente los totales/almacén/cliente recalculados por la primera (lost update). Ante este `409`, el cliente debe volver a pedir `GET /facturas/:id` (para tener el `estado`/`revision`/datos actuales) y reintentar el `PATCH` con esa información fresca — nunca reintentar a ciegas con el cuerpo original.

`revision` es enteramente server-controlado: nunca se envía en el `POST`/`PATCH`, y el cliente no necesita leerlo ni enviarlo de vuelta para que esta protección funcione.

---

## `PATCH /facturas/:id/anular` — Anular una factura

Sin cuerpo. Solo desde `edicion` o `terminada` (ver [Estados y transiciones](#estados-y-transiciones-de-una-factura-t6at6b)). La factura **no se borra**: queda con `estado: "anulada"` para conservar el registro, y su `numero`/`id` no se vuelve a usar nunca.

```http
PATCH /facturas/FAC-000005/anular
```

**Respuesta `200`:** la `Factura` con `estado: "anulada"`.
**Errores:** `404` (no existe), `409` (la factura ya está `confirmada`, `cancelada` o `anulada`).

## `DELETE /facturas/:id`

Hace **exactamente lo mismo** que `PATCH /facturas/:id/anular`: anula la factura sin borrarla. Mismas respuestas y errores.

---

## Formato de los errores

Todos los errores siguen el formato estándar de NestJS:

```json
{ "statusCode": 400, "error": "Bad Request", "message": ["property numero should not exist", "items must contain at least 1 elements"] }
```

```json
{ "statusCode": 401, "error": "Unauthorized", "message": "Unauthorized" }
```

```json
{ "statusCode": 403, "error": "Forbidden", "message": "Forbidden resource" }
```

```json
{ "statusCode": 404, "error": "Not Found", "message": "Factura con ID FAC-999999 no encontrada" }
```

```json
{ "statusCode": 409, "error": "Conflict", "message": "La factura FAC-000006 esta en estado \"terminada\": no se puede modificar concepto, items" }
```

```json
{ "statusCode": 409, "error": "Conflict", "message": "La factura FAC-000006 esta en estado \"cancelada\" y no puede pasar a \"anulada\"" }
```

```json
{ "statusCode": 422, "error": "Unprocessable Entity", "message": "El almacén \"Almacén Central\" no tiene código configurado" }
```

> En los `400` de validación, `message` es un **array** (un mensaje por cada problema). En `401`, `403`, `404`, `409` y `422` es un **string**.

---

## Cómo se calculan los totales

El servidor usa la misma fórmula que el formulario de facturación del frontend, así que los números deberían coincidir con los que muestra la pantalla antes de emitir. Por cada item:

```
bruto          = precio × cantidad
descuento      = descuentoMonto + bruto × descuentoPct / 100
descuento      = mínimo(descuento, bruto + recargo)   ← un item nunca queda negativo
item.total     = bruto − descuento + recargo
```

Y para la factura:

```
subtotal       = Σ bruto
descuentoTotal = Σ descuento
recargoTotal   = Σ recargo
base           = Σ item.total                          (= subtotal − descuentoTotal + recargoTotal)
impuesto       = base × porciento / 100                (si se envió porciento)
total          = base + impuesto
```

Todo se redondea a 2 decimales, con el 5 redondeando hacia arriba (`1.005 → 1.01`).

---

## Clientes

Si la factura trae `nit`, `telefono` o `email`, el servidor vincula la factura a un cliente (`clienteId`):

1. Lo busca por `nit`, después por `email` y después por `telefono`; usa la primera coincidencia.
2. Si no existe, lo crea automáticamente. Para los datos que falten usa valores de relleno: dirección `"Sin dirección"`, y un teléfono o email generados.

Si no se envía ninguno de los tres, la factura queda sin `clienteId` (venta al público).

---

## Checklist para el frontend

- [ ] Enviar siempre `Authorization: Bearer <token>` en todas las peticiones a `/facturas`.
- [ ] No enviar `id`, `numero`, `estado`, totales, `items[].total`, `emisor`, `almacenCodigo` ni `facturadoPor` en el `POST`.
- [ ] Enviar siempre `almacenId` (el `_id` del almacén) y el `productoId` real (`_id` de Mongo) de cada item.
- [ ] Mostrar e imprimir los datos **de la respuesta** del `POST` (número, totales, emisor, `almacenCodigo`, `facturadoPor`).
- [ ] Enviar `descuentoPct`, `descuentoMonto` y `recargo` en cada item, con `0` si no aplican.
- [ ] Paginar el listado con `page` y `limit` (máximo 500).
- [ ] Manejar el `401` (sin sesión / sesión expirada) y el `403` (rol sin permiso: solo `administrador`, `gerente` y `facturador` pueden crear, editar o anular).
- [ ] Manejar el `404`/`422` si el almacén elegido no existe o no tiene código, y el `400` si un producto no pertenece a ese almacén.
- [ ] Antes de armar el formulario de edición, consultar la [matriz de edición por estado](#matriz-de-edición-por-estado): mostrar solo los campos editables en el `estado` actual de la factura.
- [ ] Manejar el `409` al editar (el estado actual no permite alguno de los campos enviados, o la factura cambió mientras se editaba — ver [Concurrencia al editar](#concurrencia-al-editar-revision-t6c)) o al pedir una transición de estado (`terminar`/`editar`/`confirmar`/`cancelar`/`anular`) que no aplica desde el estado actual.
- [ ] Al confirmar, manejar el `409` de stock insuficiente / producto inactivo / de otro almacén (la factura sigue en `terminada`, ver [Movimientos de inventario](#movimientos-de-inventario-al-confirmar--cancelar-t7)).
- [ ] Ante el `409` de concurrencia, volver a pedir `GET /facturas/:id` y reintentar el `PATCH` con los datos frescos, en vez de reintentar a ciegas con el cuerpo original.
- [ ] Después de imprimir, marcarla con `PATCH { "impreso": true }` (funciona en cualquier estado salvo `anulada`).
