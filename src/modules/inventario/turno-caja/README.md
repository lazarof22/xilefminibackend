# Turno de caja (`TurnoCaja`)

Turno de un cajero: apertura con **fondo inicial por moneda** y cierre. Es la
base del cuadre, de las extracciones, del arqueo SC-3-06 y de los depósitos
bancarios (doc §6.6).

- Clave de moneda: el código de la moneda (`tipo_moneda`: `CUP`, `USD`...).
  Si un movimiento no informa moneda se asume `CUP`.
- Un cajero solo puede tener **un turno abierto** (validación en el servicio
  - índice único parcial `cajeroId` con `estado = abierto`).
- El cajero es el usuario autenticado (`req.user.userId`).

| Método  | Ruta                                                               | Roles                          |
| ------- | ------------------------------------------------------------------ | ------------------------------ |
| `POST`  | `/turno-caja` `{ fondoInicial: { CUP: 5000, USD: 20 } }`           | cajero, administrador          |
| `GET`   | `/turno-caja/abierto` (turno abierto del usuario, vacío si no hay) | autenticado                    |
| `GET`   | `/turno-caja?estado=&cajeroId=`                                    | autenticado                    |
| `GET`   | `/turno-caja/:id`                                                  | autenticado                    |
| `PATCH` | `/turno-caja/:id/cerrar` `{ observaciones? }`                      | cajero (propio), administrador |

Errores: 400 fondo inválido, 403 rol o turno ajeno, 404, 409 (ya hay un turno
abierto / ya está cerrado).

Registro: `TurnoCajaModule` (`./turno-caja.module`) en `AppModule`.
