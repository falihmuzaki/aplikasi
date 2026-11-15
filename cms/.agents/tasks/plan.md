# Implementation Plan — Public self-registration with email OTP verification

Scope: add a public "Daftar" (register) flow to the Lumina / Ifal Store inventory app.
New accounts are ALWAYS role `staff`, created inactive (`is_active=FALSE`), and only
activated after email-OTP verification. All work happens in the worktree
`c:\Users\Falih\Videos\aplikasi\.worktrees\self-register\crud`.

## Locked design decisions (with rationale)

- OTP columns: ADD dedicated `register_otp_hash` / `register_otp_expires_at` columns
  rather than reusing `login_otp_*`. Rationale: an unverified row is `is_active=FALSE`,
  so it already can't log in (login filters `is_active=TRUE`), but dedicated columns keep
  the three OTP flows (login / reset / register) cleanly separated, let a resend operate
  on an inactive row without entangling login state, and match the existing idempotent
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern in `schema.sql`.
- Role: the register endpoint hardcodes `'staff'` and never reads a client-supplied role,
  so a self-registering user can never become admin.
- Duplicate email: active row -> `409 { message: 'Email sudah terdaftar.' }`. Unverified
  row (`is_active=FALSE`) -> reuse that same row (UPDATE name/password_hash + fresh OTP) so
  a user who never verified can simply register again and get a new code.
- Password rule: min 8 chars + confirmation, mirroring the existing
  `/api/auth/password/reset` validation message style.
- Reuse existing helpers verbatim: `hashPassword`, `generateOtp`, `hashOtp`, `verifyOtp`,
  `normalizeUser`, `signToken`, `userFields`, `otpSendLimiter`, `loginLimiter`.
- Style: 2-space indent, NO trailing semicolons, dense one-liner handlers and fetch chains,
  parameterized SQL only, no new npm deps. Do not change any existing endpoint behavior.

## Verification note

The project has NO automated test framework. Verification uses the real project commands:
backend syntax via `node --check`, frontend via `npm run lint` (oxlint) and
`npm run build` (vite build), plus a manual runtime smoke test against a running server
(OTP codes print to the console in dev mode because SMTP is unconfigured — see
`server/mailer.js` `logDevOtp`). All `npm` commands run from the `crud` directory.

---

- [ ] 1. Add dedicated registration-OTP columns to the users table.
      Append two idempotent statements after the existing `reset_otp_*` ALTERs in schema.sql:
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS register_otp_hash TEXT` and
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS register_otp_expires_at TIMESTAMPTZ`.
      Keep every existing table, index, ALTER, and seed block intact and unchanged.
      Files: crud/server/schema.sql
      Verify: `node --check server/schema.sql` is not applicable (SQL); instead confirm the
      file still parses as valid SQL by starting the server once (step 6) — schema is applied
      on boot and an invalid statement aborts startup with a logged error. For this step,
      visually confirm the two new lines are idempotent and placed after the reset_otp ALTERs.

- [ ] 2. Extend the mailer to support a 'register' purpose.
      In `buildMessage({ code, purpose })`, add a branch so `purpose === 'register'` uses a
      verification-oriented intro (e.g. "Berikut kode OTP untuk memverifikasi email akun
      Ifal Store Anda.") while keeping the existing 'login' / 'reset' text. Add a matching
      `[DEV OTP]` line in `logDevOtp` for the register purpose (e.g. "Kode verifikasi
      pendaftaran untuk ${to}: ${code}"). Do not change the SMTP config, transporter, or the
      enumeration-safe error handling. Match 2-space indent, no semicolons.
      Files: crud/server/mailer.js
      Verify: `node --check server/mailer.js` exits 0.

- [ ] 3. Add the three registration endpoints to the Express app.
      Insert them next to the other `/api/auth/*` routes in index.js (e.g. right after
      `/api/auth/password/reset`), reusing existing helpers and the dense one-liner style:
      - `POST /api/auth/register` (otpSendLimiter): read `name`, `email`, `password`,
        `password_confirmation`. Validate name non-empty, email via
        `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, and `password.length >= 8` with
        `password === password_confirmation` (same message as reset:
        'Password minimal 8 karakter dan konfirmasi harus sama.'). Look up any existing row
        by email. If it exists AND `is_active=TRUE` -> `409 { message: 'Email sudah
        terdaftar.' }`. If it exists AND `is_active=FALSE` -> UPDATE that row's name,
        `password_hash`, `role='staff'`, `register_otp_hash`, `register_otp_expires_at =
        NOW() + INTERVAL '10 minutes'`. Otherwise INSERT a new row with `role='staff'`,
        `is_active=FALSE`, `password_hash`, and the register OTP. Hardcode `role='staff'`;
        never read role from the body. Then `sendOtpEmail({ to: email, code,
        purpose: 'register' })` and respond `{ message: 'Kode verifikasi telah dikirim ke
        email Anda.', requiresOtp: true }`. All SQL parameterized.
      - `POST /api/auth/register/verify` (loginLimiter): read `email`, `otp`. Select the
        inactive row (`email=$1 AND is_active=FALSE`) with `register_otp_hash` /
        `register_otp_expires_at`. On missing row, missing/expired hash, or failed
        `verifyOtp` -> `400 { message: 'Kode OTP tidak valid atau sudah kedaluwarsa.' }`
        (same as login/reset verify). On success: `UPDATE users SET is_active=TRUE,
        register_otp_hash=NULL, register_otp_expires_at=NULL, updated_at=NOW() WHERE id=$1
        RETURNING ${userFields}` and respond `{ user: normalizeUser(row),
        token: signToken(row.id) }`. Call `request.clearRateLimit?.()` on success like the
        other verify handlers.
      - `POST /api/auth/register/resend` (otpSendLimiter): read `email`. If an inactive row
        exists, write a fresh `register_otp_hash` / `register_otp_expires_at` and
        `sendOtpEmail({ ..., purpose: 'register' })`. Always respond
        `{ message: 'Kode verifikasi baru telah dikirim.' }` (enumeration-safe, like the
        resend/forgot handlers). Wrap each handler in the existing
        `try { ... } catch (error) { next(error) }` shape.
      Files: crud/server/index.js
      Verify: `node --check server/index.js` exits 0.

- [ ] 4. Add register state and handlers to the frontend auth screen.
      In App.jsx, next to the existing login/otp/reset state (around lines 123-130), add:
      `registerStep` (false | 'form' | 'otp'), `registerForm` ({ name, email, password,
      passwordConfirmation }), and `registerOtp`. Add three async handlers mirroring the
      existing `handleLogin` / `handleVerifyOtp` / `resendOtp` patterns and fetch style:
      - `handleRegister(event)`: POST `${API_URL}/auth/register` with the four register
        fields (send `password_confirmation`); on `!response.ok` set `loginError` from
        `result.message`; on success set `registerStep` to 'otp' and clear the error.
      - `verifyRegisterOtp(event)`: POST `${API_URL}/auth/register/verify` with
        `{ email: registerForm.email, otp: registerOtp }`; on `!response.ok` throw
        `result.message`; on success call `completeLogin(result.user, result.token)` (reuses
        the exact localStorage keys lumina-auth / lumina-user / lumina-token).
      - `resendRegisterOtp()`: POST `${API_URL}/auth/register/resend` with
        `{ email: registerForm.email }`, set `loginError` to the returned message.
      Also reset `registerStep` / `registerForm` / `registerOtp` inside `handleLogout` and
      when returning to the sign-in screen. Match 2-space indent and no trailing semicolons.
      Files: crud/src/App.jsx
      Verify: `npm run lint` passes (oxlint, run from crud/). Deferred full build is step 6.

- [ ] 5. Render the register UI inside the existing login-card.
      Extend the single `if (!isAuthenticated) return <div className="login-page">...` block
      (around line 370) to handle `registerStep`, mirroring the existing `resetStep`/`otpStep`
      conditional markup and reusing the same classes (login-card, login-brand, eyebrow,
      login-subtitle, label/input, login-error, primary-button login-button,
      secondary-button, demo-hint):
      - Form onSubmit: when `registerStep === 'form'` use `handleRegister`; when
        `registerStep === 'otp'` use `verifyRegisterOtp` (compose with the existing
        reset/otp/login ternary).
      - When `registerStep === 'form'`: show name, email, password, confirm-password inputs
        (password inputs `minLength="8"`), bound to `registerForm`. When
        `registerStep === 'otp'`: reuse the 6-digit OTP input UI (inputMode numeric,
        pattern `[0-9]{6}`, maxLength 6) bound to `registerOtp`, plus a "Kirim ulang kode"
        `secondary-button` calling `resendRegisterOtp`, and a "Kembali ke masuk" button that
        clears `registerStep`.
      - On the default sign-in view, add a `secondary-button` "Daftar" next to the existing
        "Forgot password?" button that sets `registerStep` to 'form'.
      - Keep showing `loginError` via the existing `login-error` element.
      If a genuinely new element needs styling, add minimal rules to App.css reusing existing
      design tokens; otherwise add nothing. Do not alter existing login/otp/reset markup
      behavior.
      Files: crud/src/App.jsx, crud/src/App.css (only if needed)
      Verify: `npm run build` succeeds (vite build, run from crud/) and `npm run lint` passes.

- [ ] 6. End-to-end runtime smoke test of the register flow.
      Start the API (`npm run server` from crud/, requires DATABASE_URL / a reachable
      Postgres) and the dev server (`npm run dev`). Walk the flow: open the app, click
      "Daftar", submit name/email/password/confirm, read the printed `[DEV OTP] Kode
      verifikasi pendaftaran...` line from the server console, enter the code, and confirm the
      app logs in as a `staff` user. Then confirm: (a) registering an already-active email
      returns the 409 "Email sudah terdaftar." message; (b) an unverified email can be
      re-registered / resent and then verified; (c) an unverified account cannot log in via
      the normal login form (401, because login filters `is_active=TRUE`); (d) existing login,
      MFA, forgot/reset, products, categories, users, and stock-log flows are unchanged.
      Files: none (runtime verification only)
      Verify: all flow steps above behave as described; the new staff user appears in the
      users table with `is_active=TRUE` after verification. If no Postgres is available in the
      environment, record that this step was skipped and rely on steps 1-5 verification plus
      `node --check` for the backend.

## Gaps / assumptions

- No automated test framework exists; verification leans on lint, build, `node --check`, and
  the manual smoke test. If the implementer wants regression safety, a tiny Node script
  hitting the three endpoints could be added, but that is out of scope for this task.
- Step 6 requires a running Postgres (DATABASE_URL). If unavailable, the backend is still
  validated by `node --check` and schema review; note the skip rather than blocking.
- The verdict/review file for the implement-review loop remains
  `crud/.agents/tasks/review.json` (jsonPath `verdict`) as the workflow expects; this plan
  does not restructure the workflow tail.
