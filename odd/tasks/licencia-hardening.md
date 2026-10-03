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
- [x] T5 Review follow-ups F1–F8 (backend e798c42..f46554a)
- [x] T6 Backend: new dev keypair (private key only in signer `keys/`, gitignored), refuse DEV key in production whenever present, CORS `exposedHeaders: Content-Disposition`, compensation doc wording, README revocation-limits note
- [x] T7 Frontend: fix FE-1 (admin detail endpoint/array), nullable EstadoLicencia fields, wire LoginPage to `POST /auth/login` storing the JWT
- [x] T8 End-to-end verification against a live backend + throwaway mongod (request → sign → activate → status, frontend calls)
- [x] T9 Native review of e798c42..HEAD (fresh candidate; previous range-2 lineage interrupted by session limit)

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

## Native review (backend)
- Original 885e50f exceeded the reviewer context budget → split into 12 slices (backup branch `backup/licencia-hardening-pre-split`, final tree identical). Reviewed via detached worktree `../xilefminibackend-worktrees/review-slice`.
- Slices 1–10 and 11+12 (combined, slice 11 under budget): all granted, approved, acknowledged (authority burned). Last two commits (usuarios cap + task log, 154 lines) under budget → pending in slice.
- Advisory follow-ups (non-blocking, candidate for T5):
  - F1 user cap fails open when license invalid by tamper/DB error (should only allow when sin_licencia) — slice 8
  - F2 user cap check-then-insert race (concurrent register exceeds cap) — slices 11+12
  - F3 NaN dates in derivarCodigo fail open to 'valida' — slice 3
  - F4 import with new license_id ignores global clock floor — slice 8
  - F5 production with only dev key should fail startup, not just log — slice 5
  - F6 fingerprint: absolute paths for reg/ioreg, `/reg:64`, in-flight memoization, error cause — slice 2
  - F7 DTO `version_firma` @Equals(3) + DTO tests; concurrent identical import → reimportada — slices 7, 8
  - F8 constants spec forces dev key to stay trusted (blocks prod rotation) — slice 1

## Next step
Ask user whether to fix F1–F8 (T5), then user audit (no merge/push).

## Final audit (2026-10-02) — resume here
- Backend + signer: MERGE-READY (612/612 tests, tsc clean, parity OK, merge-tree clean).
- Frontend: BLOCKED FE-1 — `Licencia.tsx:46` calls `GET /licencia` (returns array) as single `EstadoLicencia`; use `/licencia/:empresaId` or pick from list; make EstadoLicencia fields nullable.
- Native review range ee7dc16..f46554a: readability lens failed (session limit) — re-query bound STATUS and relaunch that slot.
- Todo: refuse DEV key in production whenever present (not only sole); compensation-delete failure doc wording; README revocation limits note.
- User authorized all reviews without asking and merge to master (no push) once clean.
- 2026-10-02 later: user asked to connect frontend↔backend, test it, and leave everything READY to merge (do not merge). Discovery: no dev private key exists anywhere → nobody can sign licenses the backend accepts; T6 regenerates the dev keypair.

## T6–T8 evidence
- T6 backend `4e7be43` (dev key rotated: `sR0RpkwuO2tNOAb2iJb00uPakrViiNWu+gkstudjz30=`; private key `xilef-signer/keys/dev-private.pem`, gitignored), `85d3d0a` (CORS exposedHeaders), `9793194` (docs + specs); signer `0d5e91e`. jest 238/238, tsc clean, signer 55/55, parity OK.
- T7 frontend `16f603e` (FE-1 + nullable fields), `6b045e6` (login → POST /auth/login, JWT in localStorage). eslint 0 on touched files, tsc baseline 79 unchanged, vite build OK.
- T8 live E2E (ts-node backend + throwaway mongod :27018): all 13 steps PASS — prod refuses dev key; sin_licencia; register/login; solicitud 401/200 + Content-Disposition exposed + CORS preflight; sign; activada/reimportada; estado/detail/list shapes; firma_invalida; hardware_no_coincide; v2 rejected; cap 403 at max 2; revocada + 409 secuencia_obsoleta + licencia_invalida on register; frontend build endpoints correct. Browser run skipped (no driver installed).
- Out-of-scope observations: `GET /auth` unguarded (lists user emails); `POST /auth/register` public.

## T9 + final state (ready to merge, NOT merged — user merges/pushes)
- Backend e798c42..9793194: native review approved + acknowledged (4 lenses). Full suite 614/614.
- Signer master..0d5e91e approved + acknowledged; follow-up `6d4bf2f` (self-verify interactive, renewal validation; 216 lines, under budget). 69/69 tests.
- Frontend master..6b045e6 approved + acknowledged; follow-ups `5a598e9`, `13ac3e9` (load race, activation result guard, shared base URL/token/thresholds) approved + acknowledged.
- All three branches fast-forwardable onto master, merge-tree clean.
- Cleanup: throwaway mongod stopped, review worktree removed. Backup branch `backup/licencia-hardening-pre-split` kept (delete after merge).
- Known, out of scope: `GET /auth` and `POST /auth/register` unguarded; LicenciaGuard unwired (user decision); production build must embed the production public key and drop the dev key (startup refuses otherwise).
