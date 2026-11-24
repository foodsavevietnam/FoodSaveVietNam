import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readRepoFile = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

/** Loại bỏ comment SQL (-- và /* ... *\/) để kiểm chứng chính xác câu lệnh thực thi. */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "");
}

/** Tách các khối CREATE OR REPLACE FUNCTION public.<name>(...) ... $$; */
function extractFunctions(sqlWithoutComments) {
  const regex =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(public\.[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?AS\s+\$\$[\s\S]*?\$\$\s*;/gi;
  const functions = [];
  for (const match of sqlWithoutComments.matchAll(regex)) {
    functions.push({
      name: match[1].toLowerCase(),
      rawArgs: match[2],
      fullText: match[0]
    });
  }
  return functions;
}

const sql041 = readRepoFile("database/Orders/041_atomic_order_ledger_rpcs.sql");
const sql042 = readRepoFile("database/Orders/042_scale_outbox_and_rpcs.sql");
const sql042b = readRepoFile("database/Orders/042b_scale_indexes_concurrent.sql");

const code041 = stripSqlComments(sql041);
const code042 = stripSqlComments(sql042);
const code042b = stripSqlComments(sql042b);

test("Wave 3A: 041 và 042 bọc đúng BEGIN; SET LOCAL lock_timeout = '5s'; ... COMMIT; và có ghi chú hoàn tác", () => {
  for (const [label, raw, code] of [
    ["041", sql041, code041],
    ["042", sql042, code042]
  ]) {
    assert.match(raw, /hoàn tác/i, `${label} phải có ghi chú hướng dẫn hoàn tác ở đầu file`);
    assert.match(code, /^\s*BEGIN\s*;/i, `${label} phải bắt đầu bằng BEGIN;`);
    assert.match(
      code,
      /SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'\s*;/i,
      `${label} phải đặt SET LOCAL lock_timeout = '5s';`
    );
    assert.match(code, /COMMIT\s*;\s*$/i, `${label} phải kết thúc bằng COMMIT;`);
  }
});

test("Wave 3A: 042b KHÔNG bọc BEGIN/COMMIT và mọi CREATE/DROP INDEX đều dùng CONCURRENTLY", () => {
  assert.match(sql042b, /hoàn tác/i, "042b phải có ghi chú hướng dẫn hoàn tác ở đầu file");
  assert.doesNotMatch(code042b, /\bBEGIN\b/i, "042b không được chứa BEGIN (PostgreSQL cấm CONCURRENTLY trong transaction)");
  assert.doesNotMatch(code042b, /\bCOMMIT\b/i, "042b không được chứa COMMIT");
  assert.doesNotMatch(code042b, /\bSTART\s+TRANSACTION\b/i, "042b không được chứa START TRANSACTION");

  const createIndexStmts = code042b.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]*?;/gi) ?? [];
  assert.equal(createIndexStmts.length, 12, "042b phải tạo đúng 12 chỉ mục nóng");
  for (const stmt of createIndexStmts) {
    assert.match(
      stmt,
      /^CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+/i,
      `Lệnh CREATE INDEX phải dùng CONCURRENTLY IF NOT EXISTS: ${stmt}`
    );
  }

  const dropIndexStmts = code042b.match(/DROP\s+INDEX\b[\s\S]*?;/gi) ?? [];
  assert.equal(dropIndexStmts.length, 2, "042b phải dọn đúng 2 chỉ mục trùng ràng buộc UNIQUE");
  for (const stmt of dropIndexStmts) {
    assert.match(
      stmt,
      /^DROP\s+INDEX\s+CONCURRENTLY\s+IF\s+EXISTS\s+/i,
      `Lệnh DROP INDEX phải dùng CONCURRENTLY IF EXISTS: ${stmt}`
    );
  }
});

test("Wave 3A: mọi hàm SECURITY DEFINER trong 041 và 042 đều cố định SET search_path = public và chỉ cấp EXECUTE cho service_role", () => {
  const expectedByFile = [
    {
      label: "041",
      code: code041,
      expectedNames: [
        "public.fs_reserve_order_stock",
        "public.fs_restore_order_stock_atomic",
        "public.fs_settle_order",
        "public.fs_refund_order",
        "public.fs_adjust_product_stock",
        "public.fs_increment_volunteer_stats",
        "public.fs_apply_customer_points",
        "public.fs_seller_reputation_apply_delta"
      ]
    },
    {
      label: "042",
      code: code042,
      expectedNames: [
        "public.fs_claim_background_jobs",
        "public.fs_report_live_location",
        "public.fs_purge_old_automation_runs"
      ]
    }
  ];

  for (const { label, code, expectedNames } of expectedByFile) {
    const fns = extractFunctions(code);
    assert.deepEqual(
      fns.map((fn) => fn.name),
      expectedNames,
      `${label} phải khai báo đủ và đúng danh sách hàm RPC`
    );

    for (const fn of fns) {
      assert.match(fn.fullText, /\bSECURITY\s+DEFINER\b/i, `${fn.name} phải là SECURITY DEFINER`);
      assert.match(
        fn.fullText,
        /\bSET\s+search_path\s*=\s*public\b/i,
        `${fn.name} bắt buộc phải đặt SET search_path = public`
      );

      const escapedName = fn.name.replace(".", "\\.");
      const revokePattern = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${escapedName}\\s*\\([^)]*\\)\\s+FROM\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
        "i"
      );
      const grantPattern = new RegExp(
        `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escapedName}\\s*\\([^)]*\\)\\s+TO\\s+service_role\\s*;`,
        "i"
      );
      assert.match(code, revokePattern, `${fn.name} phải REVOKE ALL FROM public, anon, authenticated`);
      assert.match(code, grantPattern, `${fn.name} phải GRANT EXECUTE TO service_role`);
    }
  }
});

test("Wave 3A (041): kiểm tra khóa chống deadlock, idempotency sổ cái, uy tín seller và ghi chú VND (DB-10)", () => {
  // P2-2a: giữ kho & hoàn kho nguyên tử
  assert.match(
    code041,
    /FROM\s+public\.products[\s\S]*?ORDER\s+BY\s+id[\s\S]*?FOR\s+UPDATE/i,
    "fs_reserve_order_stock phải khóa products theo ORDER BY id FOR UPDATE"
  );
  assert.match(
    code041,
    /FROM\s+public\.vouchers[\s\S]*?FOR\s+UPDATE/i,
    "fs_reserve_order_stock phải khóa vouchers FOR UPDATE"
  );
  assert.match(
    code041,
    /stock_restored_at\s+IS\s+NOT\s+NULL[\s\S]*?'already_restored'\s*,\s*true/i,
    "fs_restore_order_stock_atomic phải trả already_restored = true nếu stock_restored_at IS NOT NULL"
  );
  assert.match(
    code041,
    /FROM\s+public\.order_items[\s\S]*?ORDER\s+BY\s+product_id[\s\S]*?FOR\s+UPDATE/i,
    "fs_restore_order_stock_atomic phải khóa order_items theo ORDER BY product_id FOR UPDATE"
  );
  assert.match(
    code041,
    /sold_count\s*=\s*GREATEST\s*\(\s*0\s*,\s*sold_count\s*-/i,
    "fs_restore_order_stock_atomic phải kẹp sold_count bằng GREATEST(0, sold_count - qty)"
  );

  // P2-2b: sổ cái dùng đúng khóa idempotency tương thích 030_wallet_ledger.sql & ledgerService.ts
  assert.match(code041, /'order:'\s*\|\|\s*p_order_id::text\s*\|\|\s*':release:store'/);
  assert.match(code041, /'order:'\s*\|\|\s*p_order_id::text\s*\|\|\s*':release:fee'/);
  assert.match(code041, /'order:'\s*\|\|\s*p_order_id::text\s*\|\|\s*':release:donation'/);
  assert.match(code041, /'order:'\s*\|\|\s*p_order_id::text\s*\|\|\s*':refund'/);
  assert.match(code041, /'order:'\s*\|\|\s*p_order_id::text\s*\|\|\s*':clawback:store'/);
  assert.match(code041, /'order:'\s*\|\|\s*p_order_id::text\s*\|\|\s*':clawback:fee'/);
  assert.match(code041, /'order:'\s*\|\|\s*p_order_id::text\s*\|\|\s*':clawback:donation'/);

  // P2-2c: cột complaints.outcome_applied_at
  assert.match(
    code041,
    /ALTER\s+TABLE\s+public\.complaints\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+outcome_applied_at\s+timestamptz\s*;/i
  );

  // G-7: seller_reputation_status chỉ dùng đúng giá trị enum thật ('Active', 'Restricted', 'Banned') và đặt restricted_until
  const repFn = extractFunctions(code041).find((fn) => fn.name === "public.fs_seller_reputation_apply_delta");
  assert.ok(repFn, "Phải có hàm public.fs_seller_reputation_apply_delta");
  assert.doesNotMatch(
    repFn.fullText,
    /'Warning'::public\.seller_reputation_status/i,
    "Không được cast 'Warning' vào enum public.seller_reputation_status (chỉ có Active, Restricted, Banned)"
  );
  assert.match(repFn.fullText, /'Active'::public\.seller_reputation_status/);
  assert.match(repFn.fullText, /'Restricted'::public\.seller_reputation_status/);
  assert.match(repFn.fullText, /'Banned'::public\.seller_reputation_status/);
  assert.match(repFn.fullText, /INSERT\s+INTO\s+public\.seller_violations/i);

  // DB-10: COMMENT ON COLUMN cho các cột *_cents trên đủ 7 bảng
  const moneyColumns = [
    "public.products.price_cents",
    "public.products.original_price_cents",
    "public.orders.subtotal_cents",
    "public.orders.discount_cents",
    "public.orders.platform_fee_cents",
    "public.orders.donation_cents",
    "public.orders.total_cents",
    "public.order_items.unit_price_cents",
    "public.order_items.original_unit_price_cents",
    "public.wallets.balance_cents",
    "public.ledger_entries.amount_cents",
    "public.withdrawals.amount_cents",
    "public.complaints.refund_cents"
  ];
  for (const col of moneyColumns) {
    const escaped = col.replace(/\./g, "\\.");
    assert.match(
      code041,
      new RegExp(`COMMENT\\s+ON\\s+COLUMN\\s+${escaped}\\s+IS\\s+'[^']*VND nguyên \\(1 = 1 VND, không nhân 100\\)[^']*';`, "i"),
      `Thiếu COMMENT ON COLUMN chuẩn DB-10 cho ${col}`
    );
  }
});

test("Wave 3A (042): bảng background_jobs bật RLS không policy, claim dùng FOR UPDATE SKIP LOCKED, live_location khớp schema 039", () => {
  assert.match(
    code042,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.background_jobs\s*\(/i,
    "042 phải tạo bảng public.background_jobs"
  );
  assert.match(
    code042,
    /CHECK\s*\(\s*status\s+IN\s*\(\s*'pending'\s*,\s*'processing'\s*,\s*'done'\s*,\s*'failed'\s*,\s*'dead'\s*\)\s*\)/i,
    "background_jobs.status phải kiểm đủ 5 trạng thái"
  );
  assert.match(
    code042,
    /ALTER\s+TABLE\s+public\.background_jobs\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i,
    "background_jobs bắt buộc phải bật RLS"
  );
  assert.doesNotMatch(
    code042,
    /CREATE\s+POLICY[\s\S]*?ON\s+public\.background_jobs\b/i,
    "background_jobs không được tạo policy cho client (chỉ service_role truy cập)"
  );
  assert.match(
    code042,
    /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.background_jobs\s+FROM\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i
  );

  // Claim Outbox dùng FOR UPDATE SKIP LOCKED
  assert.match(code042, /FOR\s+UPDATE\s+SKIP\s+LOCKED/i, "fs_claim_background_jobs phải dùng FOR UPDATE SKIP LOCKED");
  assert.match(code042, /SET\s+status\s*=\s*'processing'/i);
  assert.match(code042, /locked_at\s*=\s*now\(\)/i);
  assert.match(code042, /attempts\s*=\s*bj\.attempts\s*\+\s*1/i);

  // Live location khớp tên cột lat/lng và bảng location_consents của 039_live_location.sql
  const locFn = extractFunctions(code042).find((fn) => fn.name === "public.fs_report_live_location");
  assert.ok(locFn, "Phải có hàm public.fs_report_live_location");
  assert.match(locFn.fullText, /FROM\s+public\.location_consents/i);
  assert.match(locFn.fullText, /INSERT\s+INTO\s+public\.live_locations\s*\([\s\S]*?\blat\b[\s\S]*?\blng\b/i);
  assert.match(locFn.fullText, /ON\s+CONFLICT\s*\(\s*actor_kind\s*,\s*actor_id\s*\)\s+DO\s+UPDATE/i);

  // Purge automation_runs theo batch
  const purgeFn = extractFunctions(code042).find((fn) => fn.name === "public.fs_purge_old_automation_runs");
  assert.ok(purgeFn, "Phải có hàm public.fs_purge_old_automation_runs");
  assert.match(purgeFn.fullText, /DELETE\s+FROM\s+public\.automation_runs/i);
  assert.match(purgeFn.fullText, /LIMIT\s+v_limit/i);
});

test("Wave 3A (042b): đủ 12 chỉ mục nóng và dọn đúng 2 chỉ mục trùng UNIQUE từ 001 & 006", () => {
  const expectedIndexes = [
    "notifications_recipient_created_idx",
    "notifications_broadcast_created_idx",
    "orders_store_settlement_held_idx",
    "orders_ledger_sync_idx",
    "orders_created_desc_idx",
    "orders_status_updated_idx",
    "donation_photos_auto_approve_idx",
    "order_messages_unread_idx",
    "donations_open_expires_idx",
    "products_store_label_active_idx",
    "complaints_pending_outcome_idx",
    "background_jobs_pending_idx"
  ];
  for (const idx of expectedIndexes) {
    assert.match(
      code042b,
      new RegExp(`CREATE\\s+INDEX\\s+CONCURRENTLY\\s+IF\\s+NOT\\s+EXISTS\\s+${idx}\\b`, "i"),
      `Thiếu chỉ mục ${idx} trong 042b`
    );
  }

  // Đối chiếu 2 chỉ mục trùng ràng buộc UNIQUE với schema gốc 001 & 006
  const sql001 = readRepoFile("database/User/001_foodsave_schema.sql");
  const sql006 = readRepoFile("database/User/006_eco_impact_tracker.sql");
  assert.match(sql001, /create\s+index\s+if\s+not\s+exists\s+vouchers_code_idx\s+on\s+public\.vouchers\s*\(\s*code\s*\)/i);
  assert.match(sql006, /create\s+index\s+if\s+not\s+exists\s+idx_eco_impact_events_source\s+on\s+public\.eco_impact_events\s*\(\s*source_type\s*,\s*source_id\s*\)/i);

  assert.match(code042b, /DROP\s+INDEX\s+CONCURRENTLY\s+IF\s+EXISTS\s+public\.vouchers_code_idx\s*;/i);
  assert.match(code042b, /DROP\s+INDEX\s+CONCURRENTLY\s+IF\s+EXISTS\s+public\.idx_eco_impact_events_source\s*;/i);
});
