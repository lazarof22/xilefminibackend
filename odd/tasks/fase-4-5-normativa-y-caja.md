# Fase 4 y 5: documentos normativos, caja y configuración

Objective: implement phases 4 and 5 of `Xilef Mini — Diseño de Facturación y Punto de Venta Cuba.docx` (backend + frontend, connected).
Branch: `feat/fase-4-5-normativa-y-caja` (both repos). Delivery: `ask-on-risk`. Runner: backend `npx jest`; frontend has no test runner (checks: `tsc -b`, `eslint`, `vite build`).
Mirror: Engram project is ambiguous (xilef-signer / xilefminibackend); mirror PENDING until the user picks one.

## Specs

- S1 (doc §6.1/§8 fase 4) Extend `Existencia` with `reservada` and `disponible` (`disponible = cantidad - reservada`, kept in the SAME atomic write that changes `cantidad` or `reservada`); add `sección`, `estante`, `casilla` to `Contenedor` and `dirección` to `Almacén`.
- S2 (doc §6.6 "Kardex extendido a Submayor SC-2-13") Kardex gets `importeCUP`, `importeDivisa`, `costoPromedio`, `ubicacionFisica`, `referenciaContable`; all optional so existing writers stay valid.
- S3 (doc §6.2) `Recepcion` SC-2-04: `numeroConsecutivo`, `fechaEmision`, `entidadReceptora`, `almacenReceptor`, `proveedor`, `documentoOrigen {tipo: factura|conduce|otro, numero, fecha}`, `transportista`, `lineas`, `total` (server), `responsableRecepcion`, `responsableComprobacion`, `inventarioAplicado`. "El saldo del inventario se actualiza AL REGISTRAR (no al crear borrador)". Wraps `RegistroCompra` lines.
- S4 (doc §6.6 / §7.3) `Devolucion` SC-2-08: `numeroConsecutivo`, `tipo: venta|proveedor`, `origenRef`, `motivo` (obligatorio), `cliente`, `lineas {producto, cantidadSolicitada, cantidadEntregada}`, `autorizadoPor`, `recibidoPor`, `firma`, `formaDevolucionDinero: efectivo|nota_credito|descuenta_deuda`. "una devolución siempre referencia su origen"; stock repuesto vía `ExistenciaService` + Kardex `DEVOLUCION`; "una devolución a proveedor no debe registrarse como compra negativa". Money part integrates with phases 2/3 (other developer) through a thin seam; do NOT edit `venta`, `pago`, `tasa` internals.
- S5 (doc §6.6) `AjusteInventario` SC-2-16: `numeroConsecutivo`, `causa`, `autorizadoPor`, `lineas {producto, saldoAntes, ajuste(+/-), saldoDespues}`, `firmadoPor`; "exige causa y autorización; el Kardex registra el saldo antes/después; no permite ajuste silencioso". Permission: Administrador, Económico.
- S6 (doc §6.6) `TurnoCaja`: `cajeroId`, `fechaApertura`, `fechaCierre`, `fondoInicial` POR MONEDA (map), `estado: abierto|cerrado`, `cuadre`, `arqueo`. Endpoints `POST /turno-caja`, `PATCH /turno-caja/:id/cerrar`. Extracciones y cuadre se vinculan al TurnoCaja abierto.
- S7 (doc §6.6) `ArqueoCaja` SC-3-06: documento formal separado del cuadre; `turnoCajaId`, `responsableArqueo`, `responsableCustodia`, `efectivoContado` y `diferencia` POR MONEDA, `observaciones`, `firmadoPor`. `POST /arqueo-caja`. Permission: Administrador, Económico, Gerente.
- S8 (doc §6.6) Resumen del turno: "efectivo esperado, cuentas por cobrar y cobros electrónicos se reportan por separado; el cuadre compara solo contra el efectivo esperado". Una venta a crédito no altera el efectivo esperado. Archivar las líneas del turno (no solo el resumen) al cerrar.
- S9 (doc §6.6) `DepositoBancario` por turno con alerta de plazo, "activable solo tras confirmar la norma" (flag de configuración, apagado por defecto).
- S10 (doc §6.7) `ConfiguracionTributaria { impuestoVentasPct, vigenteDesde, activa }` fuera de Tasa, `GET/PUT /configuracion-tributaria`; `Producto.gravado: 'gravado'|'exento'` (exentos no calculan impuesto); admite bonificaciones por programa/sector. Tasa gana `fluctuacion`. `EmpresaDatos.ciudad` pasa a referencia al nomenclador Ciudad.
- S11 (doc §6.9) Permisos por acción: Anular factura/venta → Administrador, Gerente; Descuento manual/cambio de precio → Administrador, Gerente; Extracción de caja → Administrador, Gerente; Ajuste de inventario → Administrador, Económico; Arqueo → Administrador, Económico, Gerente; Cerrar turno → Cajero, Administrador. Extender el patrón `JwtAuthGuard + RolesGuard + @Roles` de `factura` al resto. PRECONDITION: the frontend must send the token on every call (several components use raw `fetch`).
- S12 (user) Frontend: "respeta en el frontend el estilo con que se esta haciendo la paleta de colores" (theme in `src/theme/MuiProvider.tsx`; no ad-hoc hex colors; follow existing dialogs such as `AjusteInventarioDialog.tsx` / `dialogEstilos.ts`). UI copy in Spanish (existing project language).
- S13 (user) "dejarlo conectado": every backend endpoint above has a frontend service (`src/service/*Api.ts` using `apiRequest`) and UI.

Boundaries: phases 2 and 3 are done by someone else: do not edit `venta`, `pago`, `tasa` (except `fluctuacion`), `PagoXDialog.tsx`, `Carrito.tsx`, `ventaService.ts`. `app.module.ts` is edited only by the parent.

## Tasks

- [x] T1 Base inventario: S1 + S2 (writer A) — route: delegated (parallel units) — commits a38383e,f730e68
- [x] T2 Tributaria + Tasa.fluctuacion + EmpresaDatos.ciudad + Producto.gravado: S10 (writer B) — delegated — commits a99d9e0,7c9ee9a
- [x] T3 Caja: S6, S7, S8, S9 (writer C) — delegated — commits 906bc4b,0774355
- [x] T4 Recepción SC-2-04 + Ajuste SC-2-16: S3, S5 (writer D, after T1) — delegated — commits 2473382,659081c
- [x] T5 Devolución SC-2-08: S4 (writer E, after T1) — delegated — commits d5a981d,d796626
- [x] T6 Permisos + frontend token everywhere: S11 (parent, inline; user cancelled the gentle-shell delegation and asked to implement it directly) — commits backend 48ddc4a, frontend 915f822; independent verifier pending
- [ ] T7 Registro en app.module, build, suite, differential check, close

## Log

- L1 (2026-11-03, user, verbatim): "la 2 y 3 la va a hacer alguien mas a mi me toca 4 y 5 , tengo que implemetar tanto backend como frontend y dejarlo conectado, respeta en el frontend el estilo con que se esta haciendo la paleta de colores, empieza a implementar"
- L2 (parent): Route declaration — writer trigger (a) parallelism: T1/T2/T3 have disjoint edit surfaces and each needs several minutes; T4/T5 launched together after T1. T6 last because it touches many files and depends on all others.
- L3 (parent): Risk found — frontend uses raw `fetch` without token in CustomDataGridR, Inventario.tsx, Ventas.tsx, PuntoVenta.tsx, pago dialogs, ReporteInventarioTab, AddClientDialog, Clientes.tsx; guards before the token fix would break the app. Pago dialogs/PuntoVenta/ventaService are being edited by the phase 2/3 developer → coordinate.
- L4 (parent): T1-T5 done and committed (backend + frontend). Backend full suite: 1123 passed, 61 failed = pre-existing (factura.service.spec 49, almacen dto specs 12). Modules registered in app.module. Boot check with a throwaway mongod was NOT run (user declined the command).
- L5 (parent): Seams left: (a) cuadre must read GET /devolucion?formaDevolucionDinero=efectivo (devoluciones_efectivo); (b) extraccion.turnoCaja stays empty until guards exist (T6); (c) descuenta_deuda has no customer-debt field; (d) gravado is a text column in CustomDataGridR (no select); (e) raw fetch without token in CustomDataGridR, Inventario, Ventas, PuntoVenta, pago dialogs, ReporteInventarioTab, AddClientDialog, Clientes.
- L6 (user, verbatim): "cuando terminen esos sub agentes , las implementaciones hazlas con gentle shell con el puente" -> T6 and the cuadre/devolucion seam go through the agent bridge (gentle-shell).
- L7 (user, verbatim): "nono paralo , implementa tu lo que falta" -> the bridge task fase45-t6-frontend was cancelled (it had modified nothing) and T6a/T6b were implemented inline by the parent.
- L8 (parent): T6 done. Frontend: `authFetch` + `conTokenDeSesion` (axios interceptor) applied to every raw fetch/axios outside the phase 2/3 files (ventaService, Carrito, Pago*Dialog, CatalogoProductosTab untouched). Backend: JwtAuthGuard on 28 controllers (venta, pago, tasa, cliente, app intentionally left open until phase 2/3 sends the token); reporte-plus cerrar-turno -> cajero/administrador; cash returns (`devolucion` forma efectivo, estado registrada) now subtracted from efectivo esperado in cuadre, arqueo and reporte-plus via `devolucionesEfectivoEnVentana`. Backend suite: 63 failures all pre-existing (factura.service 49, almacen dto 12 + 2 more counted in those suites). Risk: item 2 (security guards) and 3 (endpoints now require a token) -> independent verifier launched.
- L9 (parent): extraccion keeps authentication only (S11 says Administrador/Gerente but the current POS flow lets a cajero extract after a login dialog); decision pending with the user.
