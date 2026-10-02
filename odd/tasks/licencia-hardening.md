# Licencia hardening

## Objective
Fix every finding of the 2026-10-02 security audit of `src/modules/licencia` (offline, on-prem licensing) and the companion signer `../xilef-signer`, then rebuild the frontend license module in `../xilefminifrontend`.

## Problem / Why
Ed25519 signing is sound, but everything around it is bypassable: public key overridable via env, no machine binding, unsigned activation key, no offline revocation, clock rollback works, DB errors fail open to a `.lic` fallback without tenant check, legacy `version_firma` downgrade throws, client-supplied nonce, plaintext key storage, unauthenticated `/licencia/activar`, `max_usuarios` not enforced, `.lic` written without permissions and errors swallowed, info leaks in public responses.

## Scope
- Backend: `src/modules/licencia/**`, user creation (for `max_usuarios`), `.env.example` comments.
- Signer: `../xilef-signer/**` (payload v3 + request-file signing).
- Frontend: `../xilefminifrontend` license module only.
- OUT OF SCOPE (user decision): applying `LicenciaGuard` globally / to routes. Guard code may be fixed, but must not be wired.

## Design decisions (parent)
- Signed payload v3 (canonical sorted JSON, shared byte-for-byte with signer): v2 fields + `license_id` (uuid), `hardware_fingerprint` (sha256 hex), `secuencia` (int, monotonic per license_id), `emitida_en` (ISO). `version_firma` pinned to 3; HMAC/AES/v1/v2 code removed.
- Activation is two-step and offline: backend emits a request (`empresa_id`, server-computed `hardware_fingerprint`), signer signs it into a `.lic` artifact `{ version_firma: 3, payload, firma }`, backend imports the artifact. Fingerprint is computed server-side only (never from the client).
- `license_id` replaces the `XILEF-XXXX` activation key as the identity/revocation handle.
- Trusted public keys are an embedded array; no env override.
- Revocation: a signed artifact with `revocada: true` and higher `secuencia` is accepted and revokes. Lower/equal `secuencia` is rejected (anti-rollback).
- Clock: HMAC-protected monotonic state file outside Mongo; block when `now < last_seen - tolerance` or `now < emitida_en`; tampered state = blocked.
- Fail closed: any verification error → invalid; no DB-error fallback, no grace period.

## Constraints
- No `any`; strict TDD (runner `npx jest src/modules/licencia`, signer `npx jest`).
- Commits: Conventional Commits, no AI attribution (user global rule).

## Tasks
- [x] T1 Backend crypto + payload v3: embedded trusted keys, no env override, remove legacy versions/HMAC/AES/nonce, server-side hardware fingerprint, request endpoint, import artifact, `license_id`, `secuencia`, revocation — findings 2,3,4,5,8,9,10,12
- [x] T2 Backend fail-closed + clock: remove DB-error `.lic` fallback, tenant check, monotonic state file, file perms 0600, surface write errors, admin-only activation, no leaks, `max_usuarios` enforced — findings 6,7,11,13,14,15,16
- [x] T3 Signer v3: shared payload builder, sign from request file, tests
- [x] T2b Second user-creation path (`UsuariosService.create`) enforces cap — follow-up from T2
- [x] T4 Frontend license module rebuild (MUI, project style)

## Route log
- T1–T3: delegated writer (writer trigger: many non-trivial files across two repos).
- T4: delegated explorer + writer.

## Progress / Evidence
- Branches: backend `fix/licencia-hardening`, signer `feat/payload-v3`.

- T1+T2: backend `885e50f` (single commit, service rewrite not splittable). jest licencia+auth 170 pass; tsc clean; full suite 558/559 (pre-existing usuarios spec failure: mock lacks toObject()).
- T2b: backend `34af44d`. 185 pass / 1 pre-existing fail.
- T3: signer `6a91e89`. 55 tests pass, tsc clean, payload-builder parity diff empty.
- Parent spot check: `npx jest src/modules/licencia` → 167 passed.
- Not done: `.env.example` (read denied by permissions) → env documented in module README.

- T4: frontend `a145e0f` on `fix/licencia-module`. eslint on module files 0 problems (parent re-ran); tsc errors 91→82, none in licencia files; `vite build` fails only on pre-existing missing `axios` (passes with axios external). No test runner → TDD exception.
- Open: backend CORS lacks `exposedHeaders: ['Content-Disposition']`; frontend LoginPage never stores the JWT (admin endpoints unusable from UI until fixed); `.env.example` not updated.

## Next step
User audit of the three branches (no merge/push). Native review of backend commits pending consent.
