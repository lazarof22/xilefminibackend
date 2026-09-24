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
| `PATCH` | `/facturas/:id` | Editar datos no fiscales (**solo en `edicion`**) | `administrador`, `gerente`, `facturador` | `200` | `400`, `401`, `403`, `404`, `409` |
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

## Estados y transiciones de una factura (T6a)

Toda factura tiene un `estado`, uno de `edicion`, `terminada`, `confirmada`, `cancelada`, `anulada`. Nace siempre en `edicion`.

| Estado | Significado |
|---|---|
| `edicion` | Estado inicial. Todos los campos de negocio son editables (por ahora, vía `PATCH /facturas/:id`, ver más abajo; T6b ampliará qué se puede editar). No hay movimiento de inventario. |
| `terminada` | Cerrada para el flujo normal de edición. Puede volver a `edicion`, confirmarse o anularse. Todavía no hay movimiento de inventario. |
| `confirmada` | Factura en firme. Descuenta inventario (T7, todavía no implementado). |
| `cancelada` | Reversa de una factura `confirmada`: aumenta inventario (T7, todavía no implementado). Estado terminal. |
| `anulada` | Estado terminal. Su `numero`/`id` nunca se reutiliza: el contador correlativo nunca se decrementa al anular, así que ninguna factura futura puede recibir ese mismo código. |

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
| `estado` | `string` | `"edicion"`, `"terminada"`, `"confirmada"`, `"cancelada"` o `"anulada"`. Toda factura nueva nace `"edicion"` (ver [Estados y transiciones](#estados-y-transiciones-de-una-factura-t6a)). |
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

## `PATCH /facturas/:id` — Editar datos no fiscales

Solo se puede editar una factura **en estado `edicion`** (ver [Estados y transiciones](#estados-y-transiciones-de-una-factura-t6a)); en cualquier otro estado devuelve `409`. Por ahora, **solo** se pueden editar estos campos (todos opcionales); T6b ampliará qué se puede editar en `edicion` y agregará el caso especial de `terminada` (solo `fecha`/`talonario`):

| Campo | Tipo |
|---|---|
| `concepto` | `string` |
| `impreso` | `boolean` |
| `direccion` | `string` |
| `telefono` | `string` |
| `email` | `string` |
| `despachadoPor` | `ParticipanteFactura` |
| `transportadoPor` | `ParticipanteFactura` |
| `recibidoPor` | `ParticipanteFactura` |

Cualquier otro campo (`items`, `total`, `numero`, `estado`, `nit`, `fecha`, `almacenId`, `almacenCodigo`, `metodoPago`, etc.) devuelve `400`. El almacén y el método de pago de una factura no se pueden cambiar después de emitida. Para corregir importes, emití una factura de `tipo: "ajuste"`.

> Los participantes (`despachadoPor`/`transportadoPor`/`recibidoPor`) sí son editables vía `PATCH`: es habitual completarlos después de emitida la factura (por ejemplo, cuando se despacha o se entrega). Igual que en el `POST`, cada uno que se envíe debe traer `nombre`, `ci` y `fecha` completos (no se puede editar un solo subcampo).

```http
PATCH /facturas/FAC-000005
Content-Type: application/json
Authorization: Bearer <token>

{ "impreso": true }
```

**Respuesta `200`:** la `Factura` actualizada.
**Errores:** `400` (campo no permitido), `404` (no existe), `409` (la factura no está en `edicion`).

> Uso típico: después de imprimir, enviar `{ "impreso": true }`.

---

## `PATCH /facturas/:id/anular` — Anular una factura

Sin cuerpo. Solo desde `edicion` o `terminada` (ver [Estados y transiciones](#estados-y-transiciones-de-una-factura-t6a)). La factura **no se borra**: queda con `estado: "anulada"` para conservar el registro, y su `numero`/`id` no se vuelve a usar nunca.

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
{ "statusCode": 409, "error": "Conflict", "message": "La factura FAC-000006 esta en estado \"terminada\": solo se puede editar una factura en edición" }
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
- [ ] Manejar el `409` al editar (solo vale en `edicion`) o al pedir una transición de estado (`terminar`/`editar`/`confirmar`/`cancelar`/`anular`) que no aplica desde el estado actual.
- [ ] Después de imprimir, marcarla con `PATCH { "impreso": true }`.
