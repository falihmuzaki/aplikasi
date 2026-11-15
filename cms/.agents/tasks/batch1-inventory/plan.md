# Implementation Plan — Batch 1 Inventory Features

All work happens inside the worktree app folder:
`c:\Users\Falih\Videos\aplikasi\.worktrees\batch1-inventory\crud`
Platform: Windows/PowerShell. Invoke npm as `npm.cmd` (the `npm` shim is blocked by the PowerShell execution policy).

No test framework exists in this project. The authoritative verification contract comes from `package.json` scripts:
- `npm.cmd run build` (vite build) — must succeed with no errors.
- `npm.cmd run lint` (oxlint) — must pass (no new errors; warnings tolerated only if pre-existing).
- `node --check server/index.js` and `node --check server/<new files>` — syntax check for ESM server files.
- DB smoke test ONLY IF a `.env` with a reachable `DATABASE_URL` exists (currently only `.env.example` is present, so this is expected to be SKIPPED).

Design decisions (made here, grounded in the existing code):
- SKU is a nullable `VARCHAR(64)` with a PARTIAL unique index (unique only when not null) so existing rows with NULL sku don't collide. Chosen over NOT NULL + default because existing rows must upgrade idempotently.
- Soft delete via `deleted_at TIMESTAMPTZ` NULL column; `GET /api/products` filters `deleted_at IS NULL`. Chosen over a separate archive table to keep `normalizeProduct` and all product queries unchanged except for the filter.
- Stock movements recorded in a transaction mirroring the existing categories PUT pattern (`pool.connect()` + BEGIN/COMMIT/ROLLBACK). Acting user name is looked up from `users` by `request.userId` inside the transaction, since `requireAuth` only sets `request.userId`.
- Barcode rendered by a self-contained Code128-B SVG generator (`src/barcode.js`) — no new dependency, matching the project's zero-extra-dependency style (see the hand-rolled rate limiter and token signer in `index.js`).
- Low-stock notifications are purely client-side derived from the already-loaded `products` list — no new backend, no email.
- `LOW_STOCK_THRESHOLD = 5` constant; low = `stock > 0 && stock <= 5` OR `status === 'Low stock'`; out = `stock === 0`.

---

- [ ] 0. Install dependencies.
      Files: none (uses existing package.json / package-lock.json).
      Verify: `npm.cmd install` completes; `node_modules` exists.

- [ ] 1. Add idempotent schema for sku, deleted_at, and the stock_movements table.
      Append to `server/schema.sql` (after the products indexes, before/after users is fine — keep products-related DDL together):
      ```sql
      ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(64);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx ON products(sku) WHERE sku IS NOT NULL;
      CREATE INDEX IF NOT EXISTS products_deleted_at_idx ON products(deleted_at);

      CREATE TABLE IF NOT EXISTS stock_movements (
        id BIGSERIAL PRIMARY KEY,
        product_id BIGINT REFERENCES products(id) ON DELETE CASCADE,
        user_id BIGINT,
        user_name VARCHAR(120),
        delta INTEGER NOT NULL,
        stock_before INTEGER NOT NULL,
        stock_after INTEGER NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id, created_at DESC);
      ```
      Files: `server/schema.sql`
      Verify: `node --check server/index.js` (schema is applied at boot; full apply only validated by the optional DB smoke test).

- [ ] 2. Extend product helpers in `server/index.js` to carry sku and deleted_at without breaking existing response shape.
      Change `productFields` to include `sku` and `deleted_at`. Add `sku` to `normalizeProduct` output (e.g. `sku: row.sku`). Add a `generateSku()` helper: `'SKU-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')`, retried on unique-violation (`error.code === '23505'`). Keep `productValues` returning the existing positional columns; handle sku separately in the create/update routes so the column list stays explicit.
      Files: `server/index.js`
      Verify: `node --check server/index.js`.

- [ ] 3. Make product create/update write stock movements and auto-generate SKU, inside a transaction.
      Rewrite `POST /api/products` and `PUT /api/products/:id` to use `pool.connect()` + BEGIN/COMMIT/ROLLBACK (mirror the categories PUT). On POST: resolve sku (use body.sku trimmed, else `generateSku()` with retry on 23505), INSERT product including sku; if resulting stock > 0 insert a stock_movements row (delta = stock, stock_before = 0, stock_after = stock, reason = body.reason || 'Initial stock'). On PUT: `SELECT stock FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`; update product (including sku when provided); if new stock != old stock insert a movement (delta = new-old, before/after, reason = body.reason || 'Manual update'). Look up acting user name: `SELECT name FROM users WHERE id=$1` using `request.userId`. All queries parameterized. Return `normalizeProduct` of the updated row (unchanged shape + sku).
      Files: `server/index.js`
      Verify: `node --check server/index.js`; `npm.cmd run lint`.

- [ ] 4. Add soft-delete, archived list, restore, and admin permanent-delete routes.
      Change `DELETE /api/products/:id` to `UPDATE products SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL` (404 when no row). Change `GET /api/products` query to `... WHERE deleted_at IS NULL ORDER BY created_at DESC`. Add `GET /api/products/archived` (requireAuth): `SELECT ${productFields} FROM products WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`. Add `POST /api/products/:id/restore` (requireAuth): `UPDATE ... SET deleted_at=NULL, updated_at=NOW() WHERE id=$1 AND deleted_at IS NOT NULL RETURNING ${productFields}`. Add `DELETE /api/products/:id/permanent` (requireAuth, requireAdmin): hard `DELETE FROM products WHERE id=$1`.
      NOTE on route ordering (Express 5): register `/api/products/archived` BEFORE `/api/products/:id` is not required since paths differ, but register `/api/products/:id/movements`, `/restore`, `/permanent` as distinct subpaths; keep `:id` routes grouped.
      Files: `server/index.js`
      Verify: `node --check server/index.js`.

- [ ] 5. Add stock-movement read routes.
      Add `GET /api/products/:id/movements` (requireAuth): `SELECT * FROM stock_movements WHERE product_id=$1 ORDER BY created_at DESC`. Add `GET /api/stock-movements` (requireAuth, requireAdmin): join product name — `SELECT m.*, p.name AS product_name FROM stock_movements m LEFT JOIN products p ON p.id=m.product_id ORDER BY m.created_at DESC LIMIT 200`. Return rows mapped to a stable camelCase shape (id, productId, productName, userId, userName, delta, stockBefore, stockAfter, reason, createdAt).
      Files: `server/index.js`
      Verify: `node --check server/index.js`; `npm.cmd run lint`.

- [ ] 6. Add a transactional bulk-import endpoint.
      Add `POST /api/products/bulk` (requireAuth) accepting `{ products: [...] }`. In one transaction: for each row, resolve sku (provided or generated), INSERT product, and insert an 'Initial stock' movement when stock > 0. COMMIT; return `{ created: [...normalizeProduct] }`. ROLLBACK on any failure and return a 400 with the offending row index/message. All parameterized.
      Files: `server/index.js`
      Verify: `node --check server/index.js`; `npm.cmd run lint`.

- [ ] 7. Create the Code128-B SVG barcode generator.
      New file `src/barcode.js` exporting `code128BarcodeSvg(value, { height=48, moduleWidth=2 } = {})` returning an SVG string, and/or a small React component wrapper. Implement the Code128-B character set, Start-B (104), checksum (mod 103), and Stop (106) with the standard 108-pattern table. Render black/white bars as `<rect>` elements. Keep it minimal but correct.
      Files: `src/barcode.js`
      Verify: `npm.cmd run build` (bundles the module); `npm.cmd run lint`.

- [ ] 8. Surface SKU + barcode and per-product movement history in the product form/table.
      In `src/App.jsx`: add `sku` to `blankForm`; add an optional SKU input (placeholder 'auto-generate if empty') to the product modal; add a SKU column to the product table; render the Code128 barcode (inline SVG from `src/barcode.js`) in the edit modal (and optionally the table). In the edit modal, fetch `GET /api/products/:id/movements` and list history (delta with +/- color, before->after, user, reason, timestamp). Reuse `.modal`, `.table-wrap`, `.status` classes; add minimal new CSS in `src/App.css` matching the existing style.
      Files: `src/App.jsx`, `src/App.css`
      Verify: `npm.cmd run build`; `npm.cmd run lint`.

- [ ] 9. Add the Archive view and wire soft-delete UX.
      In `src/App.jsx`: add an 'Archive' nav item; add an archive view listing `GET /api/products/archived` with a Restore button (`POST /api/products/:id/restore`) and, for admins, permanent delete (`DELETE /api/products/:id/permanent`). Keep the existing delete confirm modal (it now archives). Refresh product + archive lists after restore/delete. Reuse existing table/CSS classes.
      Files: `src/App.jsx`, `src/App.css`
      Verify: `npm.cmd run build`; `npm.cmd run lint`.

- [ ] 10. Add the admin Stock log view.
      In `src/App.jsx`: add a 'Stock log' nav item under Administration (admin-only, like Users); fetch `GET /api/stock-movements`; render a table (product, delta with +/- color, before->after, user, reason, timestamp). Reuse `.catalog-panel`, `.table-wrap`, `.status` classes.
      Files: `src/App.jsx`, `src/App.css`
      Verify: `npm.cmd run build`; `npm.cmd run lint`.

- [ ] 11. Add CSV import with preview and extend export with SKU.
      In `src/App.jsx`: extend `exportCsv` header/rows to include SKU (`Name,Category,Price,Stock,Status,SKU`). Add an 'Import' button next to Export; on file select, parse the CSV client-side (tolerate missing SKU/Status; columns Name, Category, Price, Stock, Status, SKU). Show a preview modal/table flagging invalid price/stock and duplicate SKUs before commit. On confirm, POST to `/api/products/bulk`; refresh products and toast the result. Reuse `.modal`, `.table-wrap` classes.
      Files: `src/App.jsx`, `src/App.css`
      Verify: `npm.cmd run build`; `npm.cmd run lint`.

- [ ] 12. Add the low-stock notification bell.
      In `src/App.jsx`: add `LOW_STOCK_THRESHOLD = 5` constant. Derive low/out-of-stock products from the loaded `products` list. Add a bell icon in the top bar with a count badge; clicking opens a dropdown/panel listing those products (name, stock) with a quick 'Edit' link that opens the product edit modal. Purely client-side; no backend; no email. Reuse existing CSS; add a small bell/badge style in `src/App.css`.
      Files: `src/App.jsx`, `src/App.css`
      Verify: `npm.cmd run build`; `npm.cmd run lint`.

- [ ] 13. Final integration verification.
      Files: none.
      Verify: `npm.cmd install` (clean), `npm.cmd run build` (success), `npm.cmd run lint` (pass), `node --check server/index.js` and `node --check src/barcode.js` are not applicable to barcode.js if it imports React — instead rely on build for client files; `node --check` the server files. Run the DB smoke test ONLY IF a reachable `.env`/`DATABASE_URL` exists (expected skipped). Confirm `normalizeProduct` response shape is unchanged except added `sku`.

## Gaps / assumptions
- No `.env` present, so the DB smoke test is expected to be skipped; build + lint + `node --check` are the enforced gates.
- No test framework exists; adding one is out of scope for Batch 1. Verification relies on the project's real build/lint/syntax-check commands.
- `requireAuth` exposes only `request.userId`; acting user name for movements is looked up from `users` inside the transaction.
