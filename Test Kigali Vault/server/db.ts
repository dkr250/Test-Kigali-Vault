import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'meridian_vault.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function generateInternalRef(): string {
  return `LST-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getUploadsDir(): string {
  return UPLOADS_DIR;
}

export function runInTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors if already rolled back
    }
    throw err;
  }
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('member', 'staff', 'super_admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_approval', 'rejected', 'deactivated', 'suspended')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_permissions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      staff_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      can_manage_storage INTEGER NOT NULL DEFAULT 0,
      can_manage_inventory INTEGER NOT NULL DEFAULT 0,
      can_manage_orders INTEGER NOT NULL DEFAULT 0,
      can_view_reports INTEGER NOT NULL DEFAULT 0,
      can_assist_members INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storage_id_counter (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_seq INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS member_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_name TEXT NOT NULL,
      storage_id TEXT UNIQUE,
      application_status TEXT NOT NULL DEFAULT 'pending' CHECK(application_status IN ('pending', 'approved', 'rejected', 'cancelled')),
      requested_space_sqm REAL NOT NULL,
      allocated_space_sqm REAL NOT NULL DEFAULT 0,
      occupied_space_sqm REAL NOT NULL DEFAULT 0,
      monthly_rental_fee REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      rejection_reason TEXT NOT NULL DEFAULT '',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storage_allocation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
      storage_id TEXT NOT NULL,
      change_type TEXT NOT NULL CHECK(change_type IN ('initial_allocation', 'expansion_approved', 'occupied_updated', 'fee_adjusted', 'membership_cancelled')),
      previous_space_sqm REAL NOT NULL,
      new_space_sqm REAL NOT NULL,
      previous_fee REAL NOT NULL,
      new_fee REAL NOT NULL,
      note TEXT NOT NULL,
      performed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS additional_storage_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES member_profiles(id) ON DELETE CASCADE,
      storage_id TEXT NOT NULL,
      requested_extra_sqm REAL NOT NULL,
      proposed_fee_increase REAL NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Rejected')),
      staff_note TEXT NOT NULL DEFAULT '',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      internal_ref TEXT UNIQUE NOT NULL,
      member_id INTEGER NOT NULL REFERENCES member_profiles(id),
      storage_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      unit_label TEXT NOT NULL DEFAULT 'units',
      price REAL NOT NULL,
      initial_qty INTEGER NOT NULL,
      available_qty INTEGER NOT NULL,
      sold_qty INTEGER NOT NULL DEFAULT 0,
      space_per_unit_sqm REAL NOT NULL DEFAULT 0.1,
      image_url TEXT NOT NULL,
      gallery_urls TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available', 'Out of Stock', 'Archived')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES product_listings(id),
      member_id INTEGER NOT NULL REFERENCES member_profiles(id),
      storage_id TEXT NOT NULL,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('initial_registration', 'restock', 'adjustment', 'sale_completed', 'archived', 'restored')),
      qty_change INTEGER NOT NULL,
      qty_before INTEGER NOT NULL,
      qty_after INTEGER NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      performed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_reference TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      fulfillment_method TEXT NOT NULL CHECK(fulfillment_method IN ('warehouse_collection', 'delivery')),
      delivery_address TEXT NOT NULL DEFAULT '',
      delivery_fee REAL NOT NULL DEFAULT 0,
      subtotal_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending Confirmation' CHECK(status IN ('Pending Confirmation', 'Confirmed', 'Ready for Collection', 'Out for Delivery', 'Completed', 'Cancelled')),
      sale_processed INTEGER NOT NULL DEFAULT 0,
      customer_confirmed_received INTEGER NOT NULL DEFAULT 0,
      customer_confirmed_at TEXT,
      processed_by INTEGER REFERENCES users(id),
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      listing_id INTEGER NOT NULL REFERENCES product_listings(id),
      member_id INTEGER NOT NULL REFERENCES member_profiles(id),
      storage_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      unit_label TEXT NOT NULL DEFAULT 'units',
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      order_item_id INTEGER UNIQUE NOT NULL REFERENCES order_items(id),
      order_reference TEXT NOT NULL,
      listing_id INTEGER NOT NULL REFERENCES product_listings(id),
      member_id INTEGER NOT NULL REFERENCES member_profiles(id),
      storage_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity_sold INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      total_amount REAL NOT NULL,
      confirmed_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('sale_completed', 'stock_change', 'product_registered', 'product_archived', 'storage_allocation', 'rental_fee', 'storage_request', 'announcement')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id),
      actor_label TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hero_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
      headline TEXT NOT NULL DEFAULT '',
      location_text TEXT NOT NULL,
      dispatch_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS popup_banner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_enabled INTEGER NOT NULL DEFAULT 0,
      image_url TEXT NOT NULL DEFAULT '',
      headline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      cta_label TEXT NOT NULL DEFAULT 'Explore Catalog',
      text_position TEXT NOT NULL DEFAULT 'bottom' CHECK(text_position IN ('top', 'center', 'bottom', 'below_image')),
      text_align TEXT NOT NULL DEFAULT 'left' CHECK(text_align IN ('left', 'center', 'right')),
      text_order TEXT NOT NULL DEFAULT 'headline_first' CHECK(text_order IN ('headline_first', 'description_first')),
      overlay_style TEXT NOT NULL DEFAULT 'dark_scrim' CHECK(overlay_style IN ('dark_scrim', 'navy_banner', 'light_card', 'transparent')),
      text_color TEXT NOT NULL DEFAULT 'white' CHECK(text_color IN ('white', 'navy', 'gold')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS popup_banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      image_url TEXT NOT NULL,
      headline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      cta_label TEXT NOT NULL DEFAULT 'Explore Catalog',
      text_position TEXT NOT NULL DEFAULT 'bottom' CHECK(text_position IN ('top', 'center', 'bottom', 'below_image')),
      text_align TEXT NOT NULL DEFAULT 'left' CHECK(text_align IN ('left', 'center', 'right')),
      text_order TEXT NOT NULL DEFAULT 'headline_first' CHECK(text_order IN ('headline_first', 'description_first')),
      overlay_style TEXT NOT NULL DEFAULT 'dark_scrim' CHECK(overlay_style IN ('dark_scrim', 'navy_banner', 'light_card', 'transparent')),
      text_color TEXT NOT NULL DEFAULT 'white' CHECK(text_color IN ('white', 'navy', 'gold')),
      trigger_type TEXT NOT NULL DEFAULT 'first_visit' CHECK(trigger_type IN ('first_visit', 'delay_seconds', 'scroll_percent', 'click_count', 'interaction_target')),
      trigger_delay_seconds INTEGER NOT NULL DEFAULT 3,
      trigger_scroll_percent INTEGER NOT NULL DEFAULT 40,
      trigger_click_threshold INTEGER NOT NULL DEFAULT 3,
      trigger_interaction_target TEXT NOT NULL DEFAULT 'any' CHECK(trigger_interaction_target IN ('any', 'category_filter', 'search_input', 'product_card', 'cart_button', 'storage_apply')),
      display_frequency TEXT NOT NULL DEFAULT 'once_ever' CHECK(display_frequency IN ('once_ever', 'once_per_session', 'every_visit')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const userCountRow = db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
  if (userCountRow.cnt === 0) {
    seedDatabase();
  }

  ensureOrderColumns();
  ensureCategoriesAndSlides();
  ensurePopupBanner();
  ensurePopupBanners();
  ensureDefaultSuperAdmin();
}

function ensureOrderColumns(): void {
  const cols = db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('customer_confirmed_received')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_confirmed_received INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.has('customer_confirmed_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_confirmed_at TEXT');
  }
}

function ensureCategoriesAndSlides(): void {
  const ts = nowIso();

  const catCount = (
    db.prepare('SELECT COUNT(*) AS cnt FROM product_categories').get() as { cnt: number }
  ).cnt;
  if (catCount === 0) {
    const defaults = [
      'Construction Materials',
      'Food & Agriculture',
      'Energy & Hardware',
      'Architectural Finishes',
    ];
    const insertCat = db.prepare(
      'INSERT OR IGNORE INTO product_categories (name, sort_order, created_at) VALUES (?, ?, ?)'
    );
    defaults.forEach((name, idx) => insertCat.run(name, idx + 1, ts));

    const existingCats = db
      .prepare('SELECT DISTINCT category FROM product_listings')
      .all() as Array<{ category: string }>;
    existingCats.forEach((row, idx) => {
      if (row.category && !defaults.includes(row.category)) {
        insertCat.run(row.category, defaults.length + idx + 1, ts);
      }
    });
  }

  const slideCount = (
    db.prepare('SELECT COUNT(*) AS cnt FROM hero_slides').get() as { cnt: number }
  ).cnt;
  if (slideCount === 0) {
    db.prepare(
      `INSERT INTO hero_slides (
        media_url, media_type, headline, location_text, dispatch_text,
        sort_order, is_active, created_at
      ) VALUES (?, 'image', ?, ?, ?, 1, 1, ?)`
    ).run(
      '/src/assets/images/hero_warehouse_vault_1794824614591.jpg',
      'Masoro Commercial Fulfillment Hub',
      'Plot 42, Kigali Special Economic Zone, Masoro',
      'Same-day warehouse collection or scheduled Kigali dispatch · Free delivery above 250,000 RWF',
      ts
    );
  }

  db.prepare(
    `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('hero_autoplay', 'true', ?)`
  ).run(ts);
  db.prepare(
    `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('hero_slide_interval_ms', '5500', ?)`
  ).run(ts);
  db.prepare(
    `UPDATE system_settings SET value = 'Kigali Vault', updated_at = ? WHERE key = 'warehouse_name' AND value = 'Meridian Vault Kigali'`
  ).run(ts);
}

function ensurePopupBanner(): void {
  const ts = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO popup_banner (
      id, is_enabled, image_url, headline, description, cta_label,
      text_position, text_align, text_order, overlay_style, text_color, updated_at
    ) VALUES (
      1, 0, ?, ?, ?, ?, 'bottom', 'left', 'headline_first', 'dark_scrim', 'white', ?
    )`
  ).run(
    '/src/assets/images/hero_warehouse_vault_1794824614591.jpg',
    'Direct Warehouse Inventory in Masoro',
    'Browse verified commercial stock from inspected Storage ID bays with same-day Kigali pickup or dispatch.',
    'Explore Catalog',
    ts
  );
}

function ensurePopupBanners(): void {
  const count = (db.prepare('SELECT COUNT(*) AS cnt FROM popup_banners').get() as { cnt: number }).cnt;
  if (count > 0) return;

  const legacy = db
    .prepare(
      `SELECT is_enabled, image_url, headline, description, cta_label,
              text_position, text_align, text_order, overlay_style, text_color, updated_at
       FROM popup_banner WHERE id = 1`
    )
    .get() as
    | {
        is_enabled: number;
        image_url: string;
        headline: string;
        description: string;
        cta_label: string;
        text_position: string;
        text_align: string;
        text_order: string;
        overlay_style: string;
        text_color: string;
        updated_at: string;
      }
    | undefined;

  if (legacy && legacy.image_url) {
    const ts = legacy.updated_at || nowIso();
    db.prepare(
      `INSERT INTO popup_banners (
        title, is_enabled, image_url, headline, description, cta_label,
        text_position, text_align, text_order, overlay_style, text_color,
        trigger_type, trigger_delay_seconds, trigger_scroll_percent,
        trigger_click_threshold, trigger_interaction_target, display_frequency,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'first_visit', 3, 40, 3, 'any', 'once_ever', 1, ?, ?)`
    ).run(
      'Welcome First-Visit Banner',
      legacy.is_enabled,
      legacy.image_url,
      legacy.headline,
      legacy.description,
      legacy.cta_label,
      legacy.text_position,
      legacy.text_align,
      legacy.text_order,
      legacy.overlay_style,
      legacy.text_color,
      ts,
      ts
    );
  }
}

function ensureDefaultSuperAdmin(): void {
  const existingTarget = db
    .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
    .get('kaberaremy8@gmail.com') as { id: number } | undefined;
  if (existingTarget) return;

  const legacyAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'super_admin' AND lower(email) = 'admin@meridianvault.rw'")
    .get() as { id: number } | undefined;
  if (legacyAdmin) {
    db.prepare('UPDATE users SET email = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(
      'kaberaremy8@gmail.com',
      hashPassword('kabera123'),
      nowIso(),
      legacyAdmin.id
    );
  }
}

function seedDatabase(): void {
  const daysAgo = (days: number, hour = 9, minute = 0): string => {
    const d = new Date('2026-11-16T12:00:00.000Z');
    d.setUTCDate(d.getUTCDate() - days);
    d.setUTCHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  runInTransaction(() => {
    // 1. System settings
    const insertSetting = db.prepare(
      'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)'
    );
    const settings: Array<[string, string]> = [
      ['warehouse_name', 'Kigali Vault'],
      ['currency_code', 'RWF'],
      ['base_rate_per_sqm', '1500'],
      ['delivery_fee', '5000'],
      ['free_delivery_threshold', '250000'],
      ['warehouse_address', 'Plot 42, Kigali Special Economic Zone, Masoro'],
      ['support_phone', '+250 788 410 900'],
      ['allow_guest_checkout', 'true'],
      ['require_staff_order_confirmation', 'true'],
    ];
    for (const [k, v] of settings) {
      insertSetting.run(k, v, daysAgo(30));
    }

    // 2. Users
    const insertUser = db.prepare(
      'INSERT INTO users (email, password_hash, full_name, phone, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const adminRes = insertUser.run(
      'kaberaremy8@gmail.com',
      hashPassword('kabera123'),
      'Jean-Paul Habimana',
      '+250 788 100 001',
      'super_admin',
      'active',
      daysAgo(60),
      daysAgo(60)
    );
    const adminId = Number(adminRes.lastInsertRowid);

    const staff1Res = insertUser.run(
      'staff01@meridianvault.rw',
      hashPassword('Staff@2026'),
      'Claire Uwimana',
      '+250 788 200 001',
      'staff',
      'active',
      daysAgo(50),
      daysAgo(50)
    );
    const staff1Id = Number(staff1Res.lastInsertRowid);

    const staff2Res = insertUser.run(
      'staff02@meridianvault.rw',
      hashPassword('Staff@2026'),
      'Eric Nshimyumuremyi',
      '+250 788 200 002',
      'staff',
      'active',
      daysAgo(48),
      daysAgo(48)
    );
    const staff2Id = Number(staff2Res.lastInsertRowid);

    const staff3Res = insertUser.run(
      'staff03@meridianvault.rw',
      hashPassword('Staff@2026'),
      'Diane Mukamana',
      '+250 788 200 003',
      'staff',
      'active',
      daysAgo(45),
      daysAgo(45)
    );
    const staff3Id = Number(staff3Res.lastInsertRowid);

    // Staff permissions
    const insertStaffPerm = db.prepare(`
      INSERT INTO staff_permissions (
        user_id, staff_code, title, can_manage_storage, can_manage_inventory,
        can_manage_orders, can_view_reports, can_assist_members, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStaffPerm.run(staff1Id, 'Staff 01', 'Storage Operations Officer', 1, 0, 0, 1, 1, adminId, daysAgo(45));
    insertStaffPerm.run(staff2Id, 'Staff 02', 'Inventory & Cataloging Specialist', 0, 1, 0, 1, 1, adminId, daysAgo(45));
    insertStaffPerm.run(staff3Id, 'Staff 03', 'Orders & Fulfillment Coordinator', 0, 0, 1, 1, 1, adminId, daysAgo(45));

    // Members
    const m1User = Number(
      insertUser.run(
        'member1@kigalibuild.rw',
        hashPassword('Member@2026'),
        'Emmanuel Mugisha',
        '+250 788 301 110',
        'member',
        'active',
        daysAgo(40),
        daysAgo(40)
      ).lastInsertRowid
    );
    const m2User = Number(
      insertUser.run(
        'member2@highlandtrade.rw',
        hashPassword('Member@2026'),
        'Sandrine Ingabire',
        '+250 788 302 220',
        'member',
        'active',
        daysAgo(35),
        daysAgo(35)
      ).lastInsertRowid
    );
    const m3User = Number(
      insertUser.run(
        'member3@solargrid.rw',
        hashPassword('Member@2026'),
        'Patrick Kayitare',
        '+250 788 303 330',
        'member',
        'active',
        daysAgo(28),
        daysAgo(28)
      ).lastInsertRowid
    );
    const m4User = Number(
      insertUser.run(
        'member4@nyungweharvest.rw',
        hashPassword('Member@2026'),
        'Aline Umutoni',
        '+250 788 304 440',
        'member',
        'active',
        daysAgo(24),
        daysAgo(24)
      ).lastInsertRowid
    );
    const m5User = Number(
      insertUser.run(
        'applicant@kivuceramics.rw',
        hashPassword('Member@2026'),
        'Olivier Gasana',
        '+250 788 305 550',
        'member',
        'pending_approval',
        daysAgo(1),
        daysAgo(1)
      ).lastInsertRowid
    );

    // 3. Storage ID counter (WH-0001 through WH-0004 issued)
    db.prepare('INSERT INTO storage_id_counter (id, last_seq) VALUES (1, 4)').run();

    const insertMember = db.prepare(`
      INSERT INTO member_profiles (
        user_id, business_name, storage_id, application_status,
        requested_space_sqm, allocated_space_sqm, occupied_space_sqm,
        monthly_rental_fee, notes, reviewed_by, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const mp1 = Number(
      insertMember.run(
        m1User,
        'Kigali Build Supplies Ltd',
        'WH-0001',
        'approved',
        120,
        120,
        68,
        180000,
        'Dry palletized bay for structural materials and tiles.',
        staff1Id,
        daysAgo(39),
        daysAgo(40)
      ).lastInsertRowid
    );
    const mp2 = Number(
      insertMember.run(
        m2User,
        'Highland Trade Partners',
        'WH-0002',
        'approved',
        90,
        90,
        44,
        135000,
        'Mixed commercial staples and construction cement.',
        staff1Id,
        daysAgo(34),
        daysAgo(35)
      ).lastInsertRowid
    );
    const mp3 = Number(
      insertMember.run(
        m3User,
        'SolarGrid East Africa',
        'WH-0003',
        'approved',
        80,
        80,
        32,
        120000,
        'Climate-stable racking for power inverters and electrical gear.',
        staff1Id,
        daysAgo(27),
        daysAgo(28)
      ).lastInsertRowid
    );
    const mp4 = Number(
      insertMember.run(
        m4User,
        'Nyungwe Harvest Co.',
        'WH-0004',
        'approved',
        80,
        110,
        51,
        165000,
        'Ventilated agricultural export lot storage.',
        staff1Id,
        daysAgo(23),
        daysAgo(24)
      ).lastInsertRowid
    );
    insertMember.run(
      m5User,
      'Kivu Architectural Supply',
      null,
      'pending',
      65,
      0,
      0,
      0,
      'Applying for dry racking for stone tiles and hardware fixtures.',
      null,
      null,
      daysAgo(1)
    );

    // 4. Storage allocation history
    const insertAllocHist = db.prepare(`
      INSERT INTO storage_allocation_history (
        member_id, storage_id, change_type, previous_space_sqm, new_space_sqm,
        previous_fee, new_fee, note, performed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAllocHist.run(mp1, 'WH-0001', 'initial_allocation', 0, 120, 0, 180000, 'Initial storage allocation approved.', staff1Id, daysAgo(39));
    insertAllocHist.run(mp2, 'WH-0002', 'initial_allocation', 0, 90, 0, 135000, 'Initial storage allocation approved.', staff1Id, daysAgo(34));
    insertAllocHist.run(mp3, 'WH-0003', 'initial_allocation', 0, 80, 0, 120000, 'Initial storage allocation approved.', staff1Id, daysAgo(27));
    insertAllocHist.run(mp4, 'WH-0004', 'initial_allocation', 0, 80, 0, 120000, 'Initial storage allocation approved.', staff1Id, daysAgo(23));
    insertAllocHist.run(mp4, 'WH-0004', 'expansion_approved', 80, 110, 120000, 165000, 'Approved +30 sqm seasonal coffee harvest expansion.', staff1Id, daysAgo(7, 9, 15));

    // Additional storage requests (1 approved historical, 1 pending for WH-0001)
    const insertStorageReq = db.prepare(`
      INSERT INTO additional_storage_requests (
        member_id, storage_id, requested_extra_sqm, proposed_fee_increase,
        reason, status, staff_note, reviewed_by, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStorageReq.run(
      mp4,
      'WH-0004',
      30,
      45000,
      'Incoming Q4 Arabica export harvest requires extra pallet lanes.',
      'Approved',
      'Allocated adjacent Bay D-04 under existing WH-0004 ID.',
      staff1Id,
      daysAgo(7, 9, 15),
      daysAgo(8)
    );
    insertStorageReq.run(
      mp1,
      'WH-0001',
      40,
      60000,
      'Receiving new shipment of structural steel and porcelain tile pallets.',
      'Pending',
      '',
      null,
      null,
      daysAgo(1, 10, 20)
    );

    // 5. Product listings (Independent listings even when same product type!)
    const insertListing = db.prepare(`
      INSERT INTO product_listings (
        internal_ref, member_id, storage_id, name, category, description,
        unit_label, price, initial_qty, available_qty, sold_qty,
        space_per_unit_sqm, image_url, gallery_urls, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const l1 = Number(
      insertListing.run(
        generateInternalRef(),
        mp1,
        'WH-0001',
        'Portland Cement (50kg Bag)',
        'Construction Materials',
        'ASTM C150 Type I/II heavy-duty Portland cement stored in climate-sealed dry bays. Ideal for structural concrete, foundations, and commercial masonry.',
        'bags',
        12000,
        60,
        50,
        10,
        0.4,
        '/src/assets/images/product_portland_cement_1794824614753.jpg',
        JSON.stringify(['/src/assets/images/product_portland_cement_1794824614753.jpg']),
        'Available',
        staff2Id,
        daysAgo(20),
        daysAgo(4)
      ).lastInsertRowid
    );

    const l2 = Number(
      insertListing.run(
        generateInternalRef(),
        mp2,
        'WH-0002',
        'Portland Cement (50kg Bag)',
        'Construction Materials',
        'Commercial grade 42.5N Portland cement in 50kg multi-wall kraft bags. Batch tested and palletized for rapid warehouse collection or site dispatch.',
        'bags',
        11500,
        40,
        30,
        10,
        0.4,
        '/src/assets/images/product_portland_cement_1794824614753.jpg',
        JSON.stringify(['/src/assets/images/product_portland_cement_1794824614753.jpg']),
        'Available',
        staff2Id,
        daysAgo(14, 10, 30),
        daysAgo(3)
      ).lastInsertRowid
    );

    const l3 = Number(
      insertListing.run(
        generateInternalRef(),
        mp1,
        'WH-0001',
        'High-Tensile Steel Rebar (12mm Bundle)',
        'Construction Materials',
        'Grade 500B ribbed structural reinforcement steel bars strapped in 10-bar commercial bundles. Corrosion-protected indoor bay storage.',
        'bundles',
        68000,
        28,
        24,
        4,
        0.8,
        '/src/assets/images/product_steel_rebar_1794824616251.jpg',
        JSON.stringify(['/src/assets/images/product_steel_rebar_1794824616251.jpg']),
        'Available',
        staff2Id,
        daysAgo(18),
        daysAgo(5)
      ).lastInsertRowid
    );

    const l4 = Number(
      insertListing.run(
        generateInternalRef(),
        mp1,
        'WH-0001',
        'Architectural Porcelain Floor Tiles (Box)',
        'Architectural Finishes',
        'Rectified matte limestone and slate-finish 60x60cm architectural porcelain tiles. Each sealed carton covers 1.44 sqm for commercial interiors.',
        'boxes',
        24500,
        65,
        65,
        0,
        0.35,
        '/src/assets/images/product_ceramic_tiles_1794824617349.jpg',
        JSON.stringify(['/src/assets/images/product_ceramic_tiles_1794824617349.jpg']),
        'Available',
        staff2Id,
        daysAgo(12),
        daysAgo(12)
      ).lastInsertRowid
    );

    const l5 = Number(
      insertListing.run(
        generateInternalRef(),
        mp3,
        'WH-0003',
        'Hybrid Solar Inverter 5kW',
        'Energy & Hardware',
        'Pure sine-wave 5kW hybrid solar inverter with dual MPPT controllers, lithium battery BMS port, and anodized aluminum heatsink chassis.',
        'units',
        780000,
        14,
        12,
        2,
        1.2,
        '/src/assets/images/product_solar_inverter_1794824617214.jpg',
        JSON.stringify(['/src/assets/images/product_solar_inverter_1794824617214.jpg']),
        'Available',
        staff2Id,
        daysAgo(15),
        daysAgo(2)
      ).lastInsertRowid
    );

    const l6 = Number(
      insertListing.run(
        generateInternalRef(),
        mp4,
        'WH-0004',
        'Specialty Arabica Coffee (25kg Sack)',
        'Food & Agriculture',
        'High-altitude washed Grade-1 Arabica whole beans packaged in export-grade jute and moisture-barrier inner liners. Ready for commercial roasteries.',
        'sacks',
        145000,
        20,
        18,
        2,
        0.75,
        '/src/assets/images/product_arabica_coffee_1794824615810.jpg',
        JSON.stringify(['/src/assets/images/product_arabica_coffee_1794824615810.jpg']),
        'Available',
        staff2Id,
        daysAgo(10),
        daysAgo(4)
      ).lastInsertRowid
    );

    const l7 = Number(
      insertListing.run(
        generateInternalRef(),
        mp2,
        'WH-0002',
        'Refined Golden Cooking Oil (5L)',
        'Food & Agriculture',
        'Food-grade pure refined vegetable cooking oil in tamper-evident 5-liter commercial jerrycans. Stored in cool, light-shielded food bays.',
        'jerrycans',
        13800,
        95,
        85,
        10,
        0.25,
        '/src/assets/images/product_cooking_oil_1794824616565.jpg',
        JSON.stringify(['/src/assets/images/product_cooking_oil_1794824616565.jpg']),
        'Available',
        staff2Id,
        daysAgo(11),
        daysAgo(3)
      ).lastInsertRowid
    );

    // Inventory movements
    const insertMove = db.prepare(`
      INSERT INTO inventory_movements (
        listing_id, member_id, storage_id, movement_type, qty_change,
        qty_before, qty_after, reference, note, performed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertMove.run(l1, mp1, 'WH-0001', 'initial_registration', 60, 0, 60, 'REG-001', 'Initial intake registered by Staff 02.', staff2Id, daysAgo(20));
    insertMove.run(l2, mp2, 'WH-0002', 'initial_registration', 40, 0, 40, 'REG-002', 'Initial intake registered by Staff 02.', staff2Id, daysAgo(14, 10, 30));
    insertMove.run(l3, mp1, 'WH-0001', 'initial_registration', 28, 0, 28, 'REG-003', 'Initial intake registered by Staff 02.', staff2Id, daysAgo(18));
    insertMove.run(l4, mp1, 'WH-0001', 'initial_registration', 65, 0, 65, 'REG-004', 'Initial intake registered by Staff 02.', staff2Id, daysAgo(12));
    insertMove.run(l5, mp3, 'WH-0003', 'initial_registration', 14, 0, 14, 'REG-005', 'Initial intake registered by Staff 02.', staff2Id, daysAgo(15));
    insertMove.run(l6, mp4, 'WH-0004', 'initial_registration', 20, 0, 20, 'REG-006', 'Initial intake registered by Staff 02.', staff2Id, daysAgo(10));
    insertMove.run(l7, mp2, 'WH-0002', 'initial_registration', 95, 0, 95, 'REG-007', 'Initial intake registered by Staff 02.', staff2Id, daysAgo(11));

    // 6. Seeded Orders & Completed Sales
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        order_reference, customer_name, customer_phone, fulfillment_method,
        delivery_address, delivery_fee, subtotal_amount, total_amount, status,
        sale_processed, processed_by, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrderItem = db.prepare(`
      INSERT INTO order_items (
        order_id, listing_id, member_id, storage_id, product_name,
        unit_label, unit_price, quantity, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSale = db.prepare(`
      INSERT INTO sales_transactions (
        order_id, order_item_id, order_reference, listing_id, member_id,
        storage_id, product_name, quantity_sold, unit_price, total_amount,
        confirmed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Completed Order 1
    const o1 = Number(
      insertOrder.run(
        'ORD-2026-1001',
        'Rwanda Civic Builders Ltd',
        '+250 788 551 010',
        'delivery',
        'KG 14 Ave, Kimihurura, Kigali',
        0,
        392000,
        392000,
        'Completed',
        1,
        staff3Id,
        daysAgo(5, 11, 45),
        daysAgo(6),
        daysAgo(5, 11, 45)
      ).lastInsertRowid
    );
    const o1i1 = Number(insertOrderItem.run(o1, l1, mp1, 'WH-0001', 'Portland Cement (50kg Bag)', 'bags', 12000, 10, 120000).lastInsertRowid);
    const o1i2 = Number(insertOrderItem.run(o1, l3, mp1, 'WH-0001', 'High-Tensile Steel Rebar (12mm Bundle)', 'bundles', 68000, 4, 272000).lastInsertRowid);
    insertSale.run(o1, o1i1, 'ORD-2026-1001', l1, mp1, 'WH-0001', 'Portland Cement (50kg Bag)', 10, 12000, 120000, staff3Id, daysAgo(5, 11, 45));
    insertSale.run(o1, o1i2, 'ORD-2026-1001', l3, mp1, 'WH-0001', 'High-Tensile Steel Rebar (12mm Bundle)', 4, 68000, 272000, staff3Id, daysAgo(5, 11, 45));
    insertMove.run(l1, mp1, 'WH-0001', 'sale_completed', -10, 60, 50, 'ORD-2026-1001', 'Completed order ORD-2026-1001 confirmed by Staff 03.', staff3Id, daysAgo(5, 11, 45));
    insertMove.run(l3, mp1, 'WH-0001', 'sale_completed', -4, 28, 24, 'ORD-2026-1001', 'Completed order ORD-2026-1001 confirmed by Staff 03.', staff3Id, daysAgo(5, 11, 45));

    // Completed Order 2
    const o2 = Number(
      insertOrder.run(
        'ORD-2026-1002',
        'Kigali Roastery & Foods',
        '+250 788 552 020',
        'warehouse_collection',
        '',
        0,
        543000,
        543000,
        'Completed',
        1,
        staff3Id,
        daysAgo(3, 14, 20),
        daysAgo(4),
        daysAgo(3, 14, 20)
      ).lastInsertRowid
    );
    const o2i1 = Number(insertOrderItem.run(o2, l2, mp2, 'WH-0002', 'Portland Cement (50kg Bag)', 'bags', 11500, 10, 115000).lastInsertRowid);
    const o2i2 = Number(insertOrderItem.run(o2, l7, mp2, 'WH-0002', 'Refined Golden Cooking Oil (5L)', 'jerrycans', 13800, 10, 138000).lastInsertRowid);
    const o2i3 = Number(insertOrderItem.run(o2, l6, mp4, 'WH-0004', 'Specialty Arabica Coffee (25kg Sack)', 'sacks', 145000, 2, 290000).lastInsertRowid);
    insertSale.run(o2, o2i1, 'ORD-2026-1002', l2, mp2, 'WH-0002', 'Portland Cement (50kg Bag)', 10, 11500, 115000, staff3Id, daysAgo(3, 14, 20));
    insertSale.run(o2, o2i2, 'ORD-2026-1002', l7, mp2, 'WH-0002', 'Refined Golden Cooking Oil (5L)', 10, 13800, 138000, staff3Id, daysAgo(3, 14, 20));
    insertSale.run(o2, o2i3, 'ORD-2026-1002', l6, mp4, 'WH-0004', 'Specialty Arabica Coffee (25kg Sack)', 2, 145000, 290000, staff3Id, daysAgo(3, 14, 20));
    insertMove.run(l2, mp2, 'WH-0002', 'sale_completed', -10, 40, 30, 'ORD-2026-1002', 'Completed order ORD-2026-1002 confirmed by Staff 03.', staff3Id, daysAgo(3, 14, 20));
    insertMove.run(l7, mp2, 'WH-0002', 'sale_completed', -10, 95, 85, 'ORD-2026-1002', 'Completed order ORD-2026-1002 confirmed by Staff 03.', staff3Id, daysAgo(3, 14, 20));
    insertMove.run(l6, mp4, 'WH-0004', 'sale_completed', -2, 20, 18, 'ORD-2026-1002', 'Completed order ORD-2026-1002 confirmed by Staff 03.', staff3Id, daysAgo(3, 14, 20));

    // Completed Order 3 (Solar Inverter)
    const o3 = Number(
      insertOrder.run(
        'ORD-2026-1003',
        'Virunga Eco Lodge',
        '+250 788 553 030',
        'delivery',
        'Musanze District, Kinigi Road',
        0,
        1560000,
        1560000,
        'Completed',
        1,
        staff3Id,
        daysAgo(2, 16, 10),
        daysAgo(3),
        daysAgo(2, 16, 10)
      ).lastInsertRowid
    );
    const o3i1 = Number(insertOrderItem.run(o3, l5, mp3, 'WH-0003', 'Hybrid Solar Inverter 5kW', 'units', 780000, 2, 1560000).lastInsertRowid);
    insertSale.run(o3, o3i1, 'ORD-2026-1003', l5, mp3, 'WH-0003', 'Hybrid Solar Inverter 5kW', 2, 780000, 1560000, staff3Id, daysAgo(2, 16, 10));
    insertMove.run(l5, mp3, 'WH-0003', 'sale_completed', -2, 14, 12, 'ORD-2026-1003', 'Completed order ORD-2026-1003 confirmed by Staff 03.', staff3Id, daysAgo(2, 16, 10));

    // Active In-Progress Orders (NOT completed yet -> no stock deduction, no sales count)
    const o4 = Number(
      insertOrder.run(
        'ORD-2026-1004',
        'Nyarugenge Interiors',
        '+250 788 554 040',
        'warehouse_collection',
        '',
        0,
        245000,
        245000,
        'Ready for Collection',
        0,
        staff3Id,
        null,
        daysAgo(1, 13, 0),
        daysAgo(1, 15, 0)
      ).lastInsertRowid
    );
    insertOrderItem.run(o4, l4, mp1, 'WH-0001', 'Architectural Porcelain Floor Tiles (Box)', 'boxes', 24500, 10, 245000);

    const o5 = Number(
      insertOrder.run(
        'ORD-2026-1005',
        'Ndera Construction Group',
        '+250 788 555 050',
        'delivery',
        'KK 31 Ave, Kicukiro, Kigali',
        5000,
        177500,
        182500,
        'Pending Confirmation',
        0,
        null,
        null,
        daysAgo(0, 8, 15),
        daysAgo(0, 8, 15)
      ).lastInsertRowid
    );
    insertOrderItem.run(o5, l2, mp2, 'WH-0002', 'Portland Cement (50kg Bag)', 'bags', 11500, 5, 57500);
    insertOrderItem.run(o5, l1, mp1, 'WH-0001', 'Portland Cement (50kg Bag)', 'bags', 12000, 10, 120000);

    // 7. Notifications for members
    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, category, title, message, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertNotif.run(m1User, 'sale_completed', 'Sale Completed · ORD-2026-1001', '10 bags of Portland Cement (50kg Bag) and 4 bundles of High-Tensile Steel Rebar sold for 392,000 RWF.', 1, daysAgo(5, 11, 45));
    insertNotif.run(m1User, 'product_registered', 'New Product Registered', 'Staff 02 registered Architectural Porcelain Floor Tiles (Box) under WH-0001 (65 boxes at 24,500 RWF).', 0, daysAgo(12));
    insertNotif.run(m1User, 'announcement', 'Q4 Bay Maintenance Notice', 'Routine aisle inspection scheduled for Saturday 06:00–08:00. Inbound collections remain unaffected.', 0, daysAgo(2));

    insertNotif.run(m2User, 'product_registered', 'New Product Registered', 'Staff 02 registered Portland Cement (50kg Bag) under WH-0002 (40 bags at 11,500 RWF).', 1, daysAgo(14, 10, 30));
    insertNotif.run(m2User, 'sale_completed', 'Sale Completed · ORD-2026-1002', '10 bags of Portland Cement and 10 jerrycans of Refined Golden Cooking Oil sold for 253,000 RWF.', 0, daysAgo(3, 14, 20));

    insertNotif.run(m3User, 'sale_completed', 'Sale Completed · ORD-2026-1003', '2 units of Hybrid Solar Inverter 5kW sold for 1,560,000 RWF.', 0, daysAgo(2, 16, 10));

    insertNotif.run(m4User, 'storage_allocation', 'Additional Storage Approved', 'Your request for +30 sqm was approved. WH-0004 capacity updated to 110 sqm (165,000 RWF/mo).', 1, daysAgo(7, 9, 15));
    insertNotif.run(m4User, 'sale_completed', 'Sale Completed · ORD-2026-1002', '2 sacks of Specialty Arabica Coffee (25kg Sack) sold for 290,000 RWF.', 0, daysAgo(3, 14, 20));

    // 8. Protected Audit Logs
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (
        actor_user_id, actor_label, actor_role, action, target_type, target_ref, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAudit.run(staff1Id, 'Staff 01', 'staff', 'approve_additional_storage', 'storage_allocation', 'WH-0004', 'Staff 01 approved additional storage (+30 sqm) for WH-0004.', daysAgo(7, 9, 15));
    insertAudit.run(staff2Id, 'Staff 02', 'staff', 'register_product', 'product_listing', 'WH-0002', 'Staff 02 registered Portland Cement (50kg Bag) for WH-0002 (40 bags at 11,500 RWF).', daysAgo(14, 10, 30));
    insertAudit.run(staff3Id, 'Staff 03', 'staff', 'complete_order', 'order', 'ORD-2026-1001', 'Staff 03 confirmed completed customer order ORD-2026-1001 (392,000 RWF).', daysAgo(5, 11, 45));
    insertAudit.run(staff3Id, 'Staff 03', 'staff', 'complete_order', 'order', 'ORD-2026-1002', 'Staff 03 confirmed completed customer order ORD-2026-1002 (543,000 RWF).', daysAgo(3, 14, 20));
    insertAudit.run(staff3Id, 'Staff 03', 'staff', 'complete_order', 'order', 'ORD-2026-1003', 'Staff 03 confirmed completed customer order ORD-2026-1003 (1,560,000 RWF).', daysAgo(2, 16, 10));
    insertAudit.run(adminId, 'Super Admin', 'super_admin', 'configure_staff_permissions', 'staff', 'Staff 01 / 02 / 03', 'Super Admin initialized granular operational permissions for warehouse staff.', daysAgo(45, 8, 0));
  });
}
