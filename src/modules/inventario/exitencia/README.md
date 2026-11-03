# Existencias unificadas (Fase 1)

Hasta ahora el inventario se llevaba en **dos lugares que no se hablaban**:

| Dato | Quién lo movía |
| --- | --- |
| `Producto.stock_inicial` (saldo del producto) | ventas, facturas, ajustes (Kardex) |
| `Existencia.cantidad` (saldo por almacén y contenedor) | transferencias |

Una venta bajaba el stock del producto pero no la existencia de ninguna ubicación,
y una transferencia movía existencias sin que el producto lo supiera. La Fase 1 hace
que **`Existencia` sea el saldo real** y que `Producto.stock_inicial` sea solo el
**total de sus existencias** (se mantiene sincronizado con el mismo `$inc`).

## Dos modos y una bandera

El sistema arranca en **modo antiguo**: nada cambia al desplegar. El cambio solo ocurre
cuando el administrador lo activa, después de conciliar.

| | Modo antiguo (por defecto) | Modo unificado |
| --- | --- | --- |
| Bandera | `configuracion_inventario.existenciasUnificadas = false` (o no existe) | `true` |
| Venta POS / factura / ajuste | descuentan `Producto.stock_inicial` como siempre | descuentan de las existencias por ubicación y actualizan el total |
| Producto con stock inicial | como siempre | exige almacén y contenedor |
| Editar `stock_inicial` de un producto | permitido | se rechaza (se cambia con ajuste, compra o transferencia) |
| Importar CSV | como siempre | no pisa el stock de los existentes; los nuevos entran con stock 0 |
| Kardex ya registrado | editable | no se edita |

La bandera se lee en cada operación. **Activarla es de un solo sentido desde la
aplicación** (ver "Volver atrás").

## Cómo ponerlo en marcha

1. **Copia de seguridad** de la base de datos (`mongodump`).
2. Copiar los archivos, compilar y reiniciar el backend. Nada cambia todavía.
3. Entrar como **administrador** → *Inventario* → botón **Conciliar existencias**
   (el número es la cantidad de productos que no cuadran).
4. Para cada producto con diferencia, decidir cuál es el valor correcto:
   * **Usar stock**: el stock del producto es el correcto → la existencia por ubicación se
     ajusta a él (solo con 0 o 1 ubicación).
   * **Usar ubicaciones**: la suma por ubicación es la correcta → el stock del producto
     pasa a ser esa suma.
   * **Contar**: conteo físico, se escribe la cantidad real de cada ubicación (también para
     productos con varias ubicaciones o sin ubicación).
5. Con **0 diferencias**, el administrador pulsa **Activar modo unificado**.
   Conviene hacerlo en un momento tranquilo, sin ventas en curso.
6. Comprobar con una venta, un ajuste y una factura de prueba.

Cada resolución queda auditada en la colección `conciliaciones_existencia` (quién, cuándo,
criterio, observación y los saldos antes y después). Si cambia el total de un producto,
también se registra en el **Kardex** (entrada o salida de conciliación).

### Datos antiguos: ids guardados como texto

En la base real los ids de `contenedores.almacen`, `productos.almacen` y
`productos.contenedor` están guardados como **texto** (el formulario los manda así y los
esquemas `Mixed` los guardan sin convertir), y también algunas existencias antiguas: las que
creaba `sincronizarUbicacionInicial` para los productos anteriores a la colección
`existencias`. Una consulta con ObjectId no encuentra un id guardado como texto, ni al revés
(por eso, por ejemplo, una transferencia desde una de esas filas daba *"El producto no existe
en la ubicación de origen"*). La Fase 1 lo resuelve así:

* Todo el código acepta las dos formas (`aObjectId` y `ambosTipos`, en `existencia.types.ts`)
  y **siempre escribe ObjectId**.
* **Conciliar un producto** y **Activar el modo unificado** dejan sus existencias antiguas con
  ObjectId (`normalizarExistencias`): convierten los ids de texto y, si una ubicación quedó en
  dos filas (una de texto y otra de ObjectId), suman sus cantidades en una sola. La suma por
  producto no cambia. Es idempotente y deja una línea en el log.
* El **reporte** solo lee: muestra una ubicación repetida como una sola.
* `sincronizarUbicacionInicial` ya crea sus filas con ObjectId.

## Roles

| Acción | Roles |
| --- | --- |
| Ver estado (`GET /existencias/estado`) | sin restricción, como el resto de `/existencias` (solo devuelve si está activo y desde cuándo) |
| Ver el reporte de conciliación | administrador, gerente, económico |
| Resolver diferencias | administrador, económico |
| Activar el modo unificado | administrador |

## Qué hace cada operación en modo unificado

* **Venta POS** (`POST /venta`): descuenta por ubicación. Primero la ubicación por defecto
  del producto; si no alcanza, la ubicación con más stock y así sucesivamente. Guarda en
  cada línea de qué ubicaciones salió. Si algo falla a mitad de una venta con varios
  productos, devuelve lo ya descontado.
* **Factura**: al confirmar descuenta (y guarda `inventarioUbicaciones`); al cancelar
  devuelve **a las mismas ubicaciones**.
* **Ajuste de inventario** (`POST /kardex`): entrada o salida con `almacenId` y
  `contenedorId` opcionales. Sin ubicación, la entrada va a la ubicación por defecto del
  producto (o a la que más stock tiene) y la salida se reparte como en una venta.
* **Producto nuevo**: con `stock_inicial > 0` crea su existencia en el almacén y contenedor
  indicados (el formulario de *Registrar Compra* ya los envía).
* **Compras y transferencias**: sin cambios. La transferencia mueve cantidad entre
  ubicaciones y el total del producto no cambia.

Todo descuento es **atómico por fila** (actualización condicional
`cantidad >= n` + `$inc`), de modo que dos cajeros no pueden vender la misma última unidad.
MongoDB standalone no tiene transacciones: las operaciones de varias filas llevan
compensación (se deshace lo aplicado si falla una fila) y, ante un error de red ambiguo,
se registra en el log en lugar de compensar a ciegas.

## API

| Método y ruta | Descripción |
| --- | --- |
| `GET /existencias/estado` | `{ unificado, unificadoEn }` |
| `GET /existencias/producto/:id` | ubicaciones con stock de un producto |
| `GET /existencias/conciliacion` | reporte: totales y productos que no cuadran |
| `POST /existencias/conciliacion/resolver` | `{ productoId, estrategia, ubicaciones?, observacion? }` con `estrategia` = `stock_producto` \| `existencias` \| `conteo` |
| `POST /existencias/conciliacion/activar` | activa el modo unificado (solo con 0 diferencias; si no, 409) |
| `POST /kardex` | ajuste; acepta `almacenId` y `contenedorId` opcionales |

Resolver devuelve `409` si el producto cambió mientras se conciliaba (venta simultánea):
se vuelve a cargar el reporte y se repite.

## Volver atrás (excepcional)

La aplicación no desactiva el modo. Si fuera imprescindible, en la base de datos:

```js
db.configuracion_inventario.updateOne(
  { clave: 'inventario' },
  { $set: { existenciasUnificadas: false } },
);
```

`stock_inicial` se mantiene sincronizado con la suma de las existencias, así que el modo
antiguo arranca cuadrado, pero a partir de ahí las ventas solo moverían `stock_inicial` y
las existencias quedarían atrasadas: habría que **volver a conciliar** antes de reactivar.

## Pruebas

```bash
# Unitarias (modelos en memoria, no necesitan base de datos)
npx jest src/modules/inventario src/modules/factura/factura-inventario.service.spec.ts
```

`existencia.datos-antiguos.spec.ts` repite lo importante con los datos **como están en la base
real** (ids de texto en contenedores y productos, filas antiguas, ubicaciones repetidas): las
demás pruebas siembran ObjectId en todo y no habrían detectado este problema.

Las pruebas de integración contra un **MongoDB real** son opcionales (se omiten si no se
define la variable). Usa una base de pruebas: su nombre debe contener `test` y **se borra
al terminar**.

```bash
# Linux / macOS
MONGO_TEST_URI=mongodb://127.0.0.1:27017/xilef_test_fase1 npx jest existencia.integration
```

```powershell
# Windows (PowerShell)
$env:MONGO_TEST_URI="mongodb://127.0.0.1:27017/xilef_test_fase1"; npx jest existencia.integration
```

Incluyen la prueba que los modelos en memoria no pueden hacer: dos ventas simultáneas de la
última unidad no la venden dos veces.

## Notas para desarrolladores

* Casi todos los esquemas del proyecto declaran los ids como `@Prop({ type: Types.ObjectId })`.
  En Mongoose 9 eso es un campo **`Mixed`**: **no convierte** un id en texto a ObjectId ni al
  consultar ni al guardar. Al tocar `Existencia` (o cualquier otro campo de referencia) usa
  siempre `new Types.ObjectId(id)`; con un texto la consulta simplemente no encuentra nada.
  El modelo falso de las pruebas (`fake-mongo-spec.ts`) imita este comportamiento, así que
  una prueba falla si un servicio busca con texto.
* `aggregate` tampoco convierte texto a ObjectId.
* Como los ids pueden estar guardados como texto **o** como ObjectId (ver "Datos antiguos"),
  los campos `Mixed` que pueden venir de datos viejos (`contenedores.almacen`,
  `productos.almacen/contenedor`, `existencias.*`) se filtran con `$in: ambosTipos(id)` y los
  ids leídos de ellos se convierten con `aObjectId` antes de escribirlos. MongoDB distingue el
  texto del ObjectId también en el índice único (dos filas "iguales" pueden convivir); algunos
  servidores compatibles, como FerretDB, no.
* `TOLERANCIA_SALDO` (5e-7) absorbe residuos binarios (0.7 − 0.4 = 0.29999999999999993) para
  poder vender "lo que queda" con cantidades decimales.

## Pendiente para fases siguientes

* Reservas (`reservada` / `disponible`) por ubicación.
* El Kardex todavía no guarda almacén y contenedor (Fase 4, Submayor de Inventarios).
* `Venta.remove` no devuelve stock (Fase 4).
* Guards y roles en `venta`, `kardex` y `existencias` (salvo la conciliación) — Fases 2 y 5.
* Los reportes de inventario/IPV leen `Producto.stock_inicial` (queda sincronizado).
