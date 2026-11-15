# Verification — Public self-registration with email OTP

Feature: `POST /api/auth/register`, `/api/auth/register/verify`, `/api/auth/register/resend`
plus the frontend "Daftar" flow. All commands run from
`c:\Users\Falih\Videos\aplikasi\.worktrees\self-register\crud`. PowerShell blocks `npm.ps1`,
so every npm command used `npm.cmd`.

Note on environment: the worktree shipped only `.env.example` (the real `.env` is gitignored
and was not present in the worktree). For the live API test I copied the main repo's working
`.env` (`c:\Users\Falih\Videos\aplikasi\crud\.env`, same `apps` database + configured `MAIL_*`)
into the worktree, ran the tests, and removed the copy afterward. The `.env` is gitignored and
was NOT committed.

## 1. Lint — `npm.cmd run lint` (oxlint)

Exit code: 0. Only pre-existing `src/App.jsx` warnings remain (lines 82, 158, 194, 205 —
`react(set-state-in-effect)` and `react(purity)` on `Date.now`/`Math.random`). None of these
point at the new register code, and no new errors/warnings were introduced.

## 2. Build — `npm.cmd run build` (vite build)

Exit code: 0. `✓ 1886 modules transformed`, built in ~1.9s.
Output: `dist/index.html`, `dist/assets/index-*.css`, `dist/assets/index-*.js`.

## 3. Backend syntax — `node --check`

`node --check server/index.js` and `node --check server/mailer.js` both exit 0.
(schema.sql validity is confirmed by the server booting cleanly in step 4 — schema is applied
on startup and an invalid statement aborts boot.)

## 4. Live API test against PostgreSQL (`apps` DB)

Started the worktree server on an alternate port so the user's running 3001/5173 stay free:
`$env:PORT=3010; node server/index.js` (background). Log showed `dotenv injected 13 env vars`
and `API ready at http://localhost:3010`. `GET /api/health` returned
`{"ok":true,"databaseTime":"2026-10-20T03:55:58.862Z"}` confirming DB connectivity.

Tests were driven by two small Node scripts (using `pg` + global `fetch`) that wrote results
to a file. DB rows were inspected directly with `pg`. Observed results:

| # | Check | Request | Result |
|---|-------|---------|--------|
| 1 | Register (fresh unique email, password>=8, matching confirmation, body also sent `role:'admin'`) | `POST /api/auth/register` | `200` `{"message":"Kode verifikasi telah dikirim ke email Anda.","requiresOtp":true}` |
| 1b | DB row created | `SELECT ... FROM users WHERE email=$1` | `{id:14, role:"staff", is_active:false, has_otp:true, has_exp:true}` — inactive staff row with register OTP + expiry set |
| 4 | Role forced to staff despite `role:'admin'` in body | (row from 1b) | `role=staff` ✓ |
| 2 | Duplicate ACTIVE email | `POST /api/auth/register` with an existing active user's email | `409` `{"message":"Email sudah terdaftar."}` |
| 3 | Unverified account cannot log in | `POST /api/auth/login` (email from step 1) | `401` `{"message":"Email atau password tidak sesuai."}` (login filters `is_active=TRUE`) |
| 5 | Bad OTP on verify | `POST /api/auth/register/verify` `otp:"000000"` | `400` `{"message":"Kode OTP tidak valid atau sudah kedaluwarsa."}` |
| 7 | Verify with correct OTP (seeded a known OTP hash via `pg`, mirroring server `hashOtp`, since the real code is emailed not printed) | `POST /api/auth/register/verify` `otp:"123456"` | `200`, token returned, `user.role=staff`, `user.isActive=true` |
| 7b | DB after verify | `SELECT role, is_active, register_otp_hash IS NULL ...` | `{role:"staff", is_active:true, otp_cleared:true}` — activated, OTP columns cleared |
| 8 | Login works after verification | `POST /api/auth/login` | `200`, token returned, `role=staff` |

Cleanup: all `selftest+%@lumina.test` rows were DELETEd (confirmed `deleted rows=1` /
pre-clean `removed leftover test rows=0`, i.e. no orphans left in the DB). The verification
server was stopped and port 3010 confirmed freed. Temp files (test scripts + capture files)
and the copied `.env` were removed from the worktree.

## Summary

Lint: pass (0 new issues). Build: pass. Backend syntax: pass. Live API: all four required
behaviors confirmed (staff-only role, OTP-gated activation, 409 on active duplicate, blocked
login while unverified) plus the full happy path (register → verify → active staff login) and
the bad-OTP rejection. Existing login/MFA/forgot-reset/products/categories/users/stock flows
were not modified.
