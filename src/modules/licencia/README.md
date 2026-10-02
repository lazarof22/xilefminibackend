# Licencia module (offline, machine-bound)

Offline license verification for an on-prem install. XILEF signs licenses with
an Ed25519 private key that never leaves the vendor machine; this backend only
**verifies**. A license is bound to one machine, carries a monotonic
`secuencia` for anti-rollback/revocation, and its status is **derived on every
check** from the signed payload + current time. Any error means **invalid**
(fail closed).

## Quick path (activation)

1. Admin calls `GET /licencia/solicitud?descargar=true` → downloads `xilef-<empresa>.req`
   (contains the server-computed `hardware_fingerprint`).
2. XILEF signs it with the signer:
   `npm run sign -- --request ./cliente.req --tipo suscripcion_anual --vence 2027-01-01 --max-usuarios 10 --out ./cliente.lic`
3. Admin posts the `.lic` content to `POST /licencia/activar`.
4. `GET /licencia/estado` (any user) / `GET /licencia/public/estado` report `valida: true`.

Renewal = same `license_id`, higher `--secuencia`. Revocation = same
`license_id`, higher `--secuencia`, `--revocar`; import it like any license.

## Formats

**Request (`.req`, unsigned, informational):**

```json
{ "version": 1, "empresa_id": "EMP-001", "hardware_fingerprint": "<64 hex>", "generada_en": "<ISO>" }
```

**Artifact (`.lic`):** `{ "version_firma": 3, "payload": { ... }, "firma": "<128 hex>" }`.
`firma` is Ed25519 over the canonical JSON (keys sorted) of exactly these fields:

| Field | Type | Notes |
|-------|------|-------|
| `activa` | boolean | `false` + not revoked = suspended (`inactiva`) |
| `emitida_en` | ISO string | vendor issue time; local clock must not be earlier (10 min tolerance) |
| `empresa_id` | string ≤ 64 | |
| `fecha_inicio` | ISO string | before it → `no_iniciada` |
| `fecha_vencimiento` | ISO string \| `null` | `null` **iff** `tipo === 'perpetua'` |
| `hardware_fingerprint` | 64 lowercase hex | must equal this machine's fingerprint |
| `license_id` | lowercase uuid | identity and revocation handle |
| `max_usuarios` | int ≥ 0 | `0` = unlimited |
| `revocada` | boolean | |
| `secuencia` | int ≥ 1 | monotonic per `license_id` |
| `tipo` | `trial` \| `suscripcion_mensual` \| `suscripcion_anual` \| `perpetua` | |

`services/payload-builder.ts` is shared byte-for-byte (except comments) with
`xilef-signer/src/shared/payload-builder.ts`; both repos test the same golden
fixture (`services/__fixtures__/payload-v3.golden.json`). Only `version_firma: 3`
is accepted; v0/v1/v2 (HMAC, pipe, unbound) are gone.

## Endpoints

| Method / path | Auth | Response |
|---------------|------|----------|
| `GET /licencia/public/estado` | none | `{ valida, estado }` only |
| `GET /licencia/estado` | JWT | `{ valida, estado, tipo, perpetua, fecha_vencimiento, dias_restantes }` (details `null` when invalid) |
| `GET /licencia/solicitud[?empresa_id=&descargar=true]` | JWT + `administrador` | request JSON; `descargar=true` adds `Content-Disposition` |
| `POST /licencia/activar` | JWT + `administrador` | `{ mensaje, resultado, licencia }`, `resultado` ∈ `activada \| actualizada \| revocada \| reimportada` |
| `GET /licencia` | JWT + `administrador` | all licenses with derived status |
| `GET /licencia/:empresaId` | JWT + `administrador` | best license of the empresa or `null` |
| `GET /licencia/admin/auditoria` | JWT + `administrador` | audit trail |

Rejections use `{ statusCode, message: "Licencia rechazada", codigo }`:

| HTTP | `codigo` |
|------|----------|
| 400 | `formato_invalido`, `version_no_soportada`, `firma_invalida`, `expirada` (DTO errors are standard Nest 400s) |
| 403 | `hardware_no_coincide`, `empresa_no_coincide` (payload vs admin JWT empresa), `reloj_alterado`, `estado_alterado` |
| 409 | `secuencia_obsoleta` (lower secuencia, or same secuencia with a different signature) |
| 500 | `archivo_no_escrito` (DB updated; re-import is idempotent), `error_interno` |

Status codes (`estado`): `valida`, `sin_licencia`, `version_no_soportada`,
`formato_invalido`, `firma_invalida`, `hardware_no_coincide`,
`empresa_no_coincide`, `reloj_alterado`, `estado_alterado`, `revocada`,
`inactiva`, `no_iniciada`, `expirada`, `error_interno`.

## Security model

| Concern | Decision |
|---------|----------|
| Trust anchor | `LICENCIA_TRUSTED_PUBLIC_KEYS` embedded in the build; any key verifies. No env override. |
| Machine binding | `HardwareFingerprintService`: sha256(namespace + platform + machine id). Linux `/etc/machine-id` (fallback `/var/lib/dbus/machine-id`), Windows `MachineGuid`, macOS `IOPlatformUUID`. No hostname/MAC. Unreadable → invalid. |
| Status | Re-verified signature + derivation on every check (`utils/licencia-estado.util.ts`). Unsigned DB fields never make a license valid. Several licenses per empresa: any valid one wins. |
| Anti-rollback | Per `license_id`: lower `secuencia` rejected; equal only if identical signature. |
| Clock | `LicenciaClockService`: HMAC-protected `license.state` (`LICENSE_STATE_PATH`, default next to the `.lic`), key = HKDF(fingerprint, embedded salt). Rollback > 10 min → `reloj_alterado`; bad MAC → `estado_alterado`. The max `ultimo_visto_ms` in Mongo is an extra floor (can only tighten). This **raises the cost** of clock tampering; it is not impossible (root + binary can forge, deleting both state and DB floor falls back to `emitida_en`). |
| `.lic` file | Write-only export (`LICENSE_FILE_PATH`, default `./license.lic`), atomic, mode 0600, errors surfaced. Never read back; to restore, re-import it. No DB-error fallback, no grace period. |
| Leaks | Public endpoint: `{ valida, estado }`. Day counts and reasons only in admin endpoints and audit (`rechazo`, `rollback_rechazado`, `reloj_alterado`, `hardware_no_coincide`, ...). |

Storage: collection `licencias_v3` (one document per `license_id`, signed
payload stored verbatim). Old `licencias` / `nonces_usados` collections are
no longer used; existing v2 licenses must be re-issued as v3.

## Production keypair (required before shipping)

The embedded key `LICENCIA_DEV_PUBLIC_KEY` is a **development** key. In
`NODE_ENV=production`, if it is the only trusted key, startup logs an ERROR.

1. On the XILEF machine: `XILEF_SIGNING_PRIVATE_KEY_PATH=/secure/xilef.pem npm run keygen` (in `xilef-signer`).
2. Copy the printed `LICENCIA_TRUSTED_PUBLIC_KEYS` entry into
   `constants/licencia.constants.ts` (and remove the dev key for production builds).
3. Back up the private key offline. Rotation: add the new key, ship, re-sign, then remove the old key.

## `empresa_id` convention

The license `empresa_id` is an opaque string compared **exactly** with the
`empresa_id` of the JWT. It is NOT the tax id (RUC/NIT).

| Where | Value |
|-------|-------|
| `Usuario.empresa_id` (`auth/schemas/empleado.schema.ts`) | optional `ObjectId` ref `Empresa` |
| JWT / `req.user.empresa_id` | that ObjectId as a 24-hex string, or absent |
| `.req` `empresa_id` | JWT value, or the admin's explicit `?empresa_id=` |
| signed payload `empresa_id` | copied verbatim from the `.req` by the signer, never retyped |

Consequences:

- Admins without `empresa_id` in the JWT must call `GET /licencia/solicitud?empresa_id=<Empresa ObjectId>`; whatever is sent is what gets signed.
- Status/cap lookups with an `empresa_id` only match a license whose payload carries that same string; a mismatch reads as `sin_licencia`.
- Requests without an `empresa_id` (JWT without empresa, public status) evaluate the install-wide license (any stored license on this machine).

## User cap (`max_usuarios`)

`LicenciaService.crearUsuarioConCupo(empresaId, { contar, crear, eliminar })`
wraps user creation in:

| Path | Scope |
|------|-------|
| `POST /auth/register` (`AuthService.register`) | users of the DTO `empresa_id`; install-wide when absent, empty or whitespace |
| `POST /usuarios` (`UsuariosService.create`) | install-wide (this DTO has no `empresa_id`), after duplicate checks |

| License state (for that scope) | Result |
|--------------------------------|--------|
| No license stored on the install at all | created, no cap (dev/testing while guards are unwired) |
| `valida`, `max_usuarios: 0` | created, unlimited |
| `valida`, `max_usuarios: N` | created while count < N, else 403 `cupo_usuarios_excedido` |
| anything else (`reloj_alterado`, `estado_alterado`, `hardware_no_coincide`, `firma_invalida`, `expirada`, `revocada`, `error_interno`, empresa without its own license while the install has one, ...) | 403 `licencia_invalida` (fail closed) |

Concurrency: count → insert → **recount**; if the recount exceeds the cap (or
fails) the just-inserted user is deleted and the request fails. The last
recount sees every surviving insert, so the cap holds without transactions
(standalone mongod). Under contention, requests may be rejected even when one
of them would have fit.

## Known gaps (tighten when guards are wired)

- `LicenciaGuard` exists, fails closed, but is **not applied** to routes nor registered as `APP_GUARD` (product decision).
- With **no license installed at all**, user creation is not blocked (so dev/testing keeps working).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `LICENSE_FILE_PATH` | `./license.lic` | exported artifact |
| `LICENSE_STATE_PATH` | `<dir of license file>/license.state` | clock state (must be writable) |
