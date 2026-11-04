# Depósito bancario (`DepositoBancario`)

Registro del depósito bancario del efectivo de un turno (doc §6.6) y alerta de
plazo. Los depósitos son una **salida física** del efectivo esperado del turno.

| Método | Ruta                                                                                                | Roles                                     |
| ------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `POST` | `/deposito-bancario` `{ turnoCajaId, monto, moneda?, banco, referencia?, fecha? }`                  | cajero, administrador, economico, gerente |
| `GET`  | `/deposito-bancario?turnoCajaId=` / `/:id`                                                          | autenticado                               |
| `GET`  | `/deposito-bancario/alertas`                                                                        | autenticado                               |
| `GET`  | `/deposito-bancario/configuracion`                                                                  | autenticado                               |
| `PUT`  | `/deposito-bancario/configuracion` `{ alertasActivas?, plazoDiasHabiles?, maxDiasEntreDepositos? }` | administrador                             |

## Alertas (apagadas por defecto)

`GET /alertas` devuelve `{ activas: false, alertas: [] }` mientras
`alertasActivas` sea `false` (valor inicial). La norma (Res. 74/2026 del BCC)
solo está verificada por fuente secundaria: se activa tras cotejar el texto
primario. Con el flag encendido:

- `turno_sin_deposito`: turno cerrado sin depósito pasados `plazoDiasHabiles`
  (defecto 1) días hábiles (lunes a viernes; no se modelan feriados).
- `maximo_dias_entre_depositos`: más de `maxDiasEntreDepositos` (defecto 5)
  días de calendario desde el último depósito.

Ambos valores son configurables, no están fijos en el código.

Registro: `DepositoBancarioModule` (`./deposito-bancario.module`) en `AppModule`.
