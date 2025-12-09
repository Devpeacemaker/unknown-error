const fs = require('fs');
const path = require('path');


const usePostgres = process.env.DATABASE_URL && 
                   (process.env.HEROKU || process.env.RENDER || 
                    process.env.DATABASE_URL.includes('postgres') ||
                    process.env.DATABASE_URL.includes('render.com'));

let db;
let pool;
let Database;

if (usePostgres) {
  
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log("🔗 Using PostgreSQL database");
} else {

  Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, 'database.sqlite');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  console.log("💾 Using SQLite database");
}

const defaultSettings = {
  antilink: 'on',
  antilinkall: 'off',
  autobio: 'on',
  antidelete: 'on',
  antitag: 'on',
  antibot: 'off',
  anticall: 'on',
  antiforeign: 'off',
  badword: 'off',
  gptdm: 'off',
  welcomegoodbye: 'off',
  autoread: 'off',
  mode: 'public',
  prefix: '.',
  autolike: 'on',
  autoview: 'on',
  wapresence: 'recording', 
  antiedit: 'private' 
};

// ================= DATABASE INITIALIZATION =================
async function initializeDatabase() {
  if (usePostgres) {
    return await initializePostgres();
  } else {
    return initializeSQLite();
  }
}

async function initializePostgres() {
  const client = await pool.connect();
  console.log("📡 Connecting to PostgreSQL...");

  try {
    // 🔹 Bot settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
      );
    `);

    // 🔹 Sudo owners
    await client.query(`
      CREATE TABLE IF NOT EXISTS sudo_owners (
        id SERIAL PRIMARY KEY,
        number TEXT UNIQUE NOT NULL
      );
    `);

    // 🔹 Badwords
    await client.query(`
      CREATE TABLE IF NOT EXISTS badwords (
        id SERIAL PRIMARY KEY,
        word TEXT UNIQUE NOT NULL
      );
    `);

    // Insert default settings if not exist
    for (const [key, value] of Object.entries(defaultSettings)) {
      await client.query(
        `INSERT INTO bot_settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING;`,
        [key, value]
      );
    }

    console.log("✅ PostgreSQL database initialized.");
    return true;
  } catch (err) {
    console.error("❌ PostgreSQL initialization error:", err);
    return false;
  } finally {
    client.release();
  }
}

function initializeSQLite() {
  console.log("💾 Initializing SQLite database...");

  try {
    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // 🔹 Bot settings
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
      )
    `).run();

    // 🔹 Sudo owners
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sudo_owners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT UNIQUE NOT NULL
      )
    `).run();

    // 🔹 Badwords
    db.prepare(`
      CREATE TABLE IF NOT EXISTS badwords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT UNIQUE NOT NULL
      )
    `).run();

    // Insert default settings if not exist
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO bot_settings (key, value) 
      VALUES (?, ?)
    `);

    const transaction = db.transaction((settings) => {
      for (const [key, value] of Object.entries(settings)) {
        insertStmt.run(key, value);
      }
    });

    transaction(defaultSettings);

    console.log("✅ SQLite database initialized.");
    return true;
  } catch (err) {
    console.error("❌ SQLite initialization error:", err);
    return false;
  }
}

// ==================================
async function getSettings() {
  if (usePostgres) {
    return await getSettingsPostgres();
  } else {
    return getSettingsSQLite();
  }
}

async function getSettingsPostgres() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT key, value FROM bot_settings WHERE key = ANY($1::text[])`,
      [Object.keys(defaultSettings)]
    );

    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }

    return settings;
  } catch (err) {
    console.error("❌ Failed to fetch settings from PostgreSQL:", err);
    return defaultSettings;
  } finally {
    client.release();
  }
}

function getSettingsSQLite() {
  try {
    const stmt = db.prepare(`
      SELECT key, value FROM bot_settings 
      WHERE key IN (${Object.keys(defaultSettings).map(() => '?').join(',')})
    `);
    
    const rows = stmt.all(...Object.keys(defaultSettings));
    const settings = { ...defaultSettings };
    
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    
    return settings;
  } catch (err) {
    console.error("❌ Failed to fetch settings from SQLite:", err);
    return defaultSettings;
  }
}

async function updateSetting(key, value) {
  if (usePostgres) {
    return await updateSettingPostgres(key, value);
  } else {
    return updateSettingSQLite(key, value);
  }
}

async function updateSettingPostgres(key, value) {
  const client = await pool.connect();
  try {
    const validKeys = Object.keys(defaultSettings);
    if (!validKeys.includes(key)) throw new Error(`Invalid setting key: ${key}`);

    await client.query(
      `UPDATE bot_settings SET value = $1 WHERE key = $2`,
      [value, key]
    );

    return true;
  } catch (err) {
    console.error("❌ Failed to update setting in PostgreSQL:", err.message || err);
    return false;
  } finally {
    client.release();
  }
}

function updateSettingSQLite(key, value) {
  try {
    const validKeys = Object.keys(defaultSettings);
    if (!validKeys.includes(key)) throw new Error(`Invalid setting key: ${key}`);

    const stmt = db.prepare(`UPDATE bot_settings SET value = ? WHERE key = ?`);
    const result = stmt.run(value, key);
    
    if (result.changes === 0) {
      // Insert if doesn't exist
      const insertStmt = db.prepare(`INSERT OR IGNORE INTO bot_settings (key, value) VALUES (?, ?)`);
      insertStmt.run(key, value);
    }
    
    return true;
  } catch (err) {
    console.error("❌ Failed to update setting in SQLite:", err.message || err);
    return false;
  }
}

// ================= SUDO OWNER FUNCTIONS =================
async function addSudoOwner(number) {
  if (usePostgres) {
    return await addSudoOwnerPostgres(number);
  } else {
    return addSudoOwnerSQLite(number);
  }
}

async function addSudoOwnerPostgres(number) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO sudo_owners (number) VALUES ($1) ON CONFLICT DO NOTHING`,
      [number]
    );
    return true;
  } catch (err) {
    console.error("❌ Failed to add sudo owner to PostgreSQL:", err);
    return false;
  } finally {
    client.release();
  }
}

function addSudoOwnerSQLite(number) {
  try {
    const stmt = db.prepare(`INSERT OR IGNORE INTO sudo_owners (number) VALUES (?)`);
    stmt.run(number);
    return true;
  } catch (err) {
    console.error("❌ Failed to add sudo owner to SQLite:", err);
    return false;
  }
}

async function removeSudoOwner(number) {
  if (usePostgres) {
    return await removeSudoOwnerPostgres(number);
  } else {
    return removeSudoOwnerSQLite(number);
  }
}

async function removeSudoOwnerPostgres(number) {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM sudo_owners WHERE number = $1`, [number]);
    return true;
  } catch (err) {
    console.error("❌ Failed to remove sudo owner from PostgreSQL:", err);
    return false;
  } finally {
    client.release();
  }
}

function removeSudoOwnerSQLite(number) {
  try {
    const stmt = db.prepare(`DELETE FROM sudo_owners WHERE number = ?`);
    stmt.run(number);
    return true;
  } catch (err) {
    console.error("❌ Failed to remove sudo owner from SQLite:", err);
    return false;
  }
}

async function getSudoOwners() {
  if (usePostgres) {
    return await getSudoOwnersPostgres();
  } else {
    return getSudoOwnersSQLite();
  }
}

async function getSudoOwnersPostgres() {
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT number FROM sudo_owners`);
    return result.rows.map(r => r.number);
  } catch (err) {
    console.error("❌ Failed to fetch sudo owners from PostgreSQL:", err);
    return [];
  } finally {
    client.release();
  }
}

function getSudoOwnersSQLite() {
  try {
    const stmt = db.prepare(`SELECT number FROM sudo_owners`);
    const rows = stmt.all();
    return rows.map(r => r.number);
  } catch (err) {
    console.error("❌ Failed to fetch sudo owners from SQLite:", err);
    return [];
  }
}

async function isSudoOwner(number) {
  if (usePostgres) {
    return await isSudoOwnerPostgres(number);
  } else {
    return isSudoOwnerSQLite(number);
  }
}

async function isSudoOwnerPostgres(number) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT 1 FROM sudo_owners WHERE number = $1`,
      [number]
    );
    return result.rowCount > 0;
  } catch (err) {
    console.error("❌ Failed to check sudo owner in PostgreSQL:", err);
    return false;
  } finally {
    client.release();
  }
}

function isSudoOwnerSQLite(number) {
  try {
    const stmt = db.prepare(`SELECT 1 FROM sudo_owners WHERE number = ?`);
    const row = stmt.get(number);
    return !!row;
  } catch (err) {
    console.error("❌ Failed to check sudo owner in SQLite:", err);
    return false;
  }
}

// ================= BADWORD FUNCTIONS =================
async function addBadword(word) {
  if (usePostgres) {
    return await addBadwordPostgres(word);
  } else {
    return addBadwordSQLite(word);
  }
}

async function addBadwordPostgres(word) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO badwords (word) VALUES ($1) ON CONFLICT DO NOTHING`,
      [word.toLowerCase()]
    );
    return true;
  } catch (err) {
    console.error("❌ Failed to add badword to PostgreSQL:", err);
    return false;
  } finally {
    client.release();
  }
}

function addBadwordSQLite(word) {
  try {
    const stmt = db.prepare(`INSERT OR IGNORE INTO badwords (word) VALUES (?)`);
    stmt.run(word.toLowerCase());
    return true;
  } catch (err) {
    console.error("❌ Failed to add badword to SQLite:", err);
    return false;
  }
}

async function removeBadword(word) {
  if (usePostgres) {
    return await removeBadwordPostgres(word);
  } else {
    return removeBadwordSQLite(word);
  }
}

async function removeBadwordPostgres(word) {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM badwords WHERE word = $1`, [word.toLowerCase()]);
    return true;
  } catch (err) {
    console.error("❌ Failed to remove badword from PostgreSQL:", err);
    return false;
  } finally {
    client.release();
  }
}

function removeBadwordSQLite(word) {
  try {
    const stmt = db.prepare(`DELETE FROM badwords WHERE word = ?`);
    stmt.run(word.toLowerCase());
    return true;
  } catch (err) {
    console.error("❌ Failed to remove badword from SQLite:", err);
    return false;
  }
}

async function getBadwords() {
  if (usePostgres) {
    return await getBadwordsPostgres();
  } else {
    return getBadwordsSQLite();
  }
}

async function getBadwordsPostgres() {
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT word FROM badwords`);
    return result.rows.map(r => r.word);
  } catch (err) {
    console.error("❌ Failed to fetch badwords from PostgreSQL:", err);
    return [];
  } finally {
    client.release();
  }
}

function getBadwordsSQLite() {
  try {
    const stmt = db.prepare(`SELECT word FROM badwords`);
    const rows = stmt.all();
    return rows.map(r => r.word);
  } catch (err) {
    console.error("❌ Failed to fetch badwords from SQLite:", err);
    return [];
  }
}

// ================= =================
function backupSQLiteDatabase() {
  if (!usePostgres && db) {
    try {
      const backupPath = path.join(__dirname, `database_backup_${Date.now()}.sqlite`);
      fs.copyFileSync(path.join(__dirname, 'database.sqlite'), backupPath);
      console.log(`✅ SQLite database backed up to: ${backupPath}`);
      return backupPath;
    } catch (err) {
      console.error("❌ Failed to backup SQLite database:", err);
      return null;
    }
  }
}

// ================= ================
async function closeDatabase() {
  if (usePostgres && pool) {
    await pool.end();
    console.log("🔗 PostgreSQL connection closed");
  } else if (db) {
    db.close();
    console.log("💾 SQLite connection closed");
  }
}

module.exports = {
  initializeDatabase,
  getSettings,
  updateSetting,
  addSudoOwner,
  removeSudoOwner,
  getSudoOwners,
  isSudoOwner,
  addBadword,
  removeBadword,
  getBadwords,
  backupSQLiteDatabase,
  closeDatabase,

  getDatabaseType: () => usePostgres ? 'postgresql' : 'sqlite'
};
