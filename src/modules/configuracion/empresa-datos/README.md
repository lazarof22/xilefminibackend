# Módulo Empresa-Datos

Gestiona los datos de la empresa que usa XILEF. Un solo registro con upsert.

> `/empresa` es exclusivo de estos datos (singleton). El listado de empresas clientes/proveedores (módulo `clientes y provedores/empresa`) vive en `/empresas`; `empresa-rutas.spec.ts` verifica que ningún otro controlador use `/empresa`.

## Endpoints

### `GET /empresa` (público)
Obtiene los datos actuales de la empresa.

**Response 200:**
```json
{
  "_id": "60d5f9f8...",
  "nombre": "XILEF C.A.",
  "eslogan": "Innovación y calidad",
  "direccion": "Av. Principal 123",
  "telefono": "+58 212 5550000",
  "email": "info@xilef.com",
  "ruc_nit": "J-987654321-0",
  "ciudad": "Caracas",
  "pais": "Venezuela",
  "logo": "data:image/png;base64,...",
  "createdAt": "...",
  "updatedAt": "..."
}
```
Si no hay datos, retorna `null`.

---

### `PUT /empresa` (admin)
Guarda o actualiza los datos. Todos los campos son opcionales.

**Body:**
```json
{
  "nombre": "XILEF C.A.",
  "eslogan": "Innovación y calidad",
  "direccion": "Av. Principal 123",
  "telefono": "+58 212 5550000",
  "email": "info@xilef.com",
  "ruc_nit": "J-987654321-0",
  "ciudad": "Caracas",
  "pais": "Venezuela"
}
```

**Response 200:** El documento creado/actualizado completo.

---

### `POST /empresa/logo` (admin)
Sube o actualiza el logo de la empresa.

**Body:**
```json
{ "logo": "data:image/png;base64,iVBORw0KGgo=..." }
```

**Response 200:** El documento con el logo actualizado.

Si no existe registro previo, crea uno con `nombre: "Sin nombre"`.

## Schema

| Campo | Tipo | Requerido |
|-------|------|-----------|
| nombre | string | ✅ |
| eslogan | string | |
| direccion | string | |
| telefono | string | |
| email | string | |
| ruc_nit | string | |
| ciudad | string | |  (nombre imprimible; texto libre en datos antiguos)
| ciudadId | ObjectId (ref Ciudad) | | (nuevo; se envía en `PUT`, tiene prioridad sobre `ciudad`)
| pais | string | |
| logo | string | (base64) |
| createdAt | Date | auto |
| updatedAt | Date | auto |

## Lógica

- **Upsert**: Si existe un registro, lo actualiza. Si no, lo crea.
- **Logo**: Misma lógica. Si no hay registro, crea uno temporal.
- **Colección**: `empresa_datos` (un solo documento).

## Ciudad (referencia al nomenclador)

- `ciudadId` referencia a `Ciudad`; `ciudad` conserva siempre un texto imprimible (la factura copia el emisor desde ahí).
- `GET /empresa` devuelve en `ciudad` el nombre actual de la Ciudad referenciada; si el documento es antiguo (solo texto) o la Ciudad ya no existe, devuelve el texto guardado.
- `PUT /empresa` con `ciudadId`: valida que exista. Con `ciudad` en texto (compatibilidad): reutiliza la Ciudad del país con ese nombre o la crea; sin país solo guarda el texto. `ciudad: ""` limpia ambos campos.
