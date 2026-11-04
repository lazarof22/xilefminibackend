# Arqueo de caja SC-3-06 (`ArqueoCaja`)

Comprobación **formal** del efectivo de un turno (Res. 12/2007), documento
separado del cuadre operativo (`cuadre_caja`). Esperado, contado y diferencia
van **por moneda** (clave = código de moneda): una diferencia en CUP nunca se
suma con otra en USD.

| Método | Ruta                                                                   | Roles                             |
| ------ | ---------------------------------------------------------------------- | --------------------------------- |
| `POST` | `/arqueo-caja`                                                         | administrador, economico, gerente |
| `GET`  | `/arqueo-caja/esperado/:turnoCajaId` (precarga el esperado por moneda) | idem                              |
| `GET`  | `/arqueo-caja?turnoCajaId=` / `/arqueo-caja/:id`                       | idem                              |

`POST` recibe `{ turnoCajaId, responsableArqueo, responsableCustodia,
efectivoContado: { CUP: { contado, denominaciones? } }, observaciones,
firmadoPor }`. El servidor calcula:

- `esperado` por moneda = fondo inicial del turno + efectivo recibido -
  extracciones del turno - depósitos del turno (el crédito y las
  transferencias no entran). Las ventas se toman por fecha dentro de la
  ventana del turno (filas abiertas del Reporte Plus + líneas archivadas); el
  Reporte Plus no guarda el cajero, así que turnos simultáneos de varios
  cajeros comparten la misma caja.
- `diferencia` por moneda = contado - esperado, con estado `cuadrado`,
  `sobrante` o `faltante`.
- `mismoResponsableQueCajero`: `true` si quien cuenta es el cajero del turno.
  No se rechaza (la norma puede exigir otra persona); queda marcado en el
  documento y se devuelve.

Un turno admite un solo arqueo (409 si ya existe). Al crearlo se enlaza en
`TurnoCaja.arqueo`. Falta el contado de una moneda con efectivo esperado: 400.

Registro: `ArqueoCajaModule` (`./arqueo-caja.module`) en `AppModule`.
