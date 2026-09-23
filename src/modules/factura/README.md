# Módulo Factura — Contrato de la API

Guía para conectar el frontend con los endpoints de `/facturas`: qué envía cada uno, qué devuelve y qué errores puede dar.

> **Regla de oro:** el frontend envía **qué se vendió y a quién**. El servidor decide **el número, el id, el estado, los totales, el impuesto y el emisor**. Si el frontend manda alguno de esos campos, la petición se rechaza con `400`.

---

## Resumen de endpoints

| Método | Ruta | Para qué | Éxito | Errores |
|---|---|---|---|---|
| `POST` | `/facturas` | Emitir una factura | `201` | `400` |
| `GET` | `/facturas` | Listar facturas (paginado) | `200` | `400` |
| `GET` | `/facturas/:id` | Ver una factura | `200` | `404` |
| `PATCH` | `/facturas/:id` | Editar datos no fiscales | `200` | `400`, `404`, `409` |
| `PATCH` | `/facturas/:id/anular` | Anular una factura | `200` | `404`, `409` |
| `DELETE` | `/facturas/:id` | Anular (baja lógica, **no borra**) | `200` | `404`, `409` |

- `:id` es el identificador legible de la factura (por ejemplo `FAC-000005`), **no** el `_id` de Mongo.
- Todas las peticiones con cuerpo usan `Content-Type: application/json`.
- Hoy estas rutas no piden autenticación.

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
  "emisor": {
    "nombre": "Empresa Dev SA",
    "nit": "NIT-EMPRESA-DEV",
    "direccion": "Calle Dev 1",
    "telefono": "555000",
    "email": "dev@empresa.test"
  },
  "impuesto": { "tipo": "IVA", "porciento": 10, "importe": 22.85 },
  "metodoPago": "efectivo",
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
  "estado": "confirmada",
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
| `emisor` | `object` | **Opcional:** se toma de los datos de la empresa (`/empresa`). No aparece si la empresa no está configurada. |
| `impuesto` | `object` | **Opcional:** `importe` siempre lo calcula el servidor cuando hay `porciento`. |
| `items[].total` | `number` | Lo calcula el servidor (ver [Cómo se calculan los totales](#cómo-se-calculan-los-totales)). |
| `subtotal`, `descuentoTotal`, `recargoTotal`, `total` | `number` | Los calcula el servidor. Redondeados a 2 decimales. |
| `estado` | `string` | `"confirmada"` o `"anulada"`. Toda factura nueva nace `"confirmada"`. |
| `tipo` | `string` | `"factura_normal"` (por defecto) o `"ajuste"`. |
| `impreso` | `boolean` | `false` por defecto. |

> Los campos opcionales **no vienen en el JSON** cuando no tienen valor; no llegan como `null`. En TypeScript tipalos como `campo?: tipo`.

---

## `POST /facturas` — Emitir una factura

### Cuerpo

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `metodoPago` | `string` | **Sí** | No puede estar vacío. |
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

**`ItemFactura`**

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `id` | `string` | **Sí** | Identificador local del item (lo genera el frontend). |
| `productoId` | `string` | **Sí** | |
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

`id`, `numero`, `estado`, `subtotal`, `descuentoTotal`, `recargoTotal`, `total`, `emisor`, `items[].total`

### Ejemplo

```http
POST /facturas
Content-Type: application/json

{
  "metodoPago": "efectivo",
  "cliente": "Ana Pérez",
  "nit": "12345678901",
  "direccion": "Calle 1 #23",
  "impuesto": { "tipo": "IVA", "porciento": 10 },
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
      "recargo": 3
    }
  ]
}
```

**Respuesta `201`:** el objeto [`Factura`](#el-objeto-factura-lo-que-devuelve-el-servidor) completo, con `id`, `numero`, totales y `emisor` ya calculados. **Usá esta respuesta para imprimir la factura**, no los totales que calculó el frontend.

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

Una factura emitida es un documento fiscal: **solo** se pueden editar estos campos (todos opcionales):

| Campo | Tipo |
|---|---|
| `concepto` | `string` |
| `impreso` | `boolean` |
| `direccion` | `string` |
| `telefono` | `string` |
| `email` | `string` |

Cualquier otro campo (`items`, `total`, `numero`, `estado`, `nit`, `fecha`, etc.) devuelve `400`. Para corregir importes, emití una factura de `tipo: "ajuste"`.

```http
PATCH /facturas/FAC-000005
Content-Type: application/json

{ "impreso": true }
```

**Respuesta `200`:** la `Factura` actualizada.
**Errores:** `400` (campo no permitido), `404` (no existe), `409` (la factura está anulada).

> Uso típico: después de imprimir, enviar `{ "impreso": true }`.

---

## `PATCH /facturas/:id/anular` — Anular una factura

Sin cuerpo. La factura **no se borra**: queda con `estado: "anulada"` para conservar el registro.

```http
PATCH /facturas/FAC-000005/anular
```

**Respuesta `200`:** la `Factura` con `estado: "anulada"`.
**Errores:** `404` (no existe), `409` (ya estaba anulada).

## `DELETE /facturas/:id`

Hace **exactamente lo mismo** que `PATCH /facturas/:id/anular`: anula la factura sin borrarla. Mismas respuestas y errores.

---

## Formato de los errores

Todos los errores siguen el formato estándar de NestJS:

```json
{ "statusCode": 400, "error": "Bad Request", "message": ["property numero should not exist", "items must contain at least 1 elements"] }
```

```json
{ "statusCode": 404, "error": "Not Found", "message": "Factura con ID FAC-999999 no encontrada" }
```

```json
{ "statusCode": 409, "error": "Conflict", "message": "La factura FAC-000006 esta anulada y no puede ser modificada" }
```

> En los `400` de validación, `message` es un **array** (un mensaje por cada problema). En `404` y `409` es un **string**.

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

- [ ] No enviar `id`, `numero`, `estado`, totales, `items[].total` ni `emisor` en el `POST`.
- [ ] Mostrar e imprimir los datos **de la respuesta** del `POST` (número, totales, emisor).
- [ ] Enviar `descuentoPct`, `descuentoMonto` y `recargo` en cada item, con `0` si no aplican.
- [ ] Paginar el listado con `page` y `limit` (máximo 500).
- [ ] Manejar el `409` al editar o anular una factura ya anulada.
- [ ] Después de imprimir, marcarla con `PATCH { "impreso": true }`.
