# Módulo Import/Export

Importación CSV (productos y cuentas) y respaldo/restauración JSON de toda la base de datos.

## Endpoints

Todos protegidos con JWT + rol `administrador`.

### `POST /importar/csv` (admin)

Importa productos desde un string CSV. Si el producto ya existe (por código), lo actualiza.

**Body:**
```json
{
  "csv": "codigo,nombre,precio_compra,precio_venta,stock_inicial,stock_minimo\nP001,Producto 1,100,150,50,10\nP002,Producto 2,200,300,30,5"
}
```

Columnas requeridas:
```
codigo, nombre, precio_compra, precio_venta, stock_inicial, stock_minimo
```

**Response 200:**
```json
{ "imported": 2, "errors": [] }
```

---

### `POST /importar/csv/cuentas` (admin)

Importa cuentas contables desde CSV.

Columnas requeridas:
```
codigo, nombre, naturaleza, moneda
```

Columnas opcionales:
```
denominacion, grupo, padre, descripcion, partida, elemento
```

- `naturaleza` se busca/crea en el nomenclador `NaturalezaCuenta`.
- `moneda` debe ser un ObjectId válido.
- `padre` debe ser el ObjectId de una cuenta existente.
- Si el `codigo` ya existe, la fila se rechaza.

**Body:**
```json
{
  "csv": "codigo,nombre,naturaleza,moneda,grupo\n1.1.1,Caja,Deudora,64f0...,Activo\n2.1.1,Cuentas por Pagar,Acreedora,64f0...,Pasivo"
}
```

---

### `GET /respaldo/exportar` (admin)

Exporta todas las colecciones de MongoDB como JSON.

---

### `POST /respaldo/importar` (admin)

Restaura datos desde un JSON (formato de exportación).