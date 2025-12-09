const fs = require('fs');
const path = require('path');


const usePostgres = process.env.DATABASE_URL && 
                   (process.env.HEROKU || process.env.RENDER || 
                    process.env.DATABASE_URL.includes('postgres') ||
                    process.env.DATABASE_URL.includes('render.com'));

let db;
let pool;

if (usePostgres) {
 
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log("🔗 Using PostgreSQL database");
} else {

  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, 'database.sqlite');
  db = new sqlite3.Database(dbPath);
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

// ==================================
async function initializeDatabase() {
  if (usePostgres) {
    return await initializePostgres();
  } else {
    return await initializeSQLite();
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
  return new Promise((resolve, reject) => {
    console.log("💾 Initializing SQLite database...");

    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');

    // 🔹 Bot settings
    db.run(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error("❌ Failed to create bot_settings table:", err);
        reject(err);
        return;
      }

      // 🔹 Sudo owners
      db.run(`
        CREATE TABLE IF NOT EXISTS sudo_owners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number TEXT UNIQUE NOT NULL
        )
      `, (err) => {
        if (err) {
          console.error("❌ Failed to create sudo_owners table:", err);
          reject(err);
          return;
        }

        // 🔹 Badwords
        db.run(`
          CREATE TABLE IF NOT EXISTS badwords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT UNIQUE NOT NULL
          )
        `, (err) => {
          if (err) {
            console.error("❌ Failed to create badwords table:", err);
            reject(err);
            return;
          }

          // Insert default settings if not exist
          const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO bot_settings (key, value) 
            VALUES (?, ?)
          `);

       
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            for (const [key, value] of Object.entries(defaultSettings)) {
              insertStmt.run(key, value);
            }
            
            insertStmt.finalize();
            db.run('COMMIT', (err) => {
              if (err) {
                console.error("❌ Failed to insert default settings:", err);
                reject(err);
              } else {
                console.log("✅ SQLite database initialized.");
                resolve(true);
              }
            });
          });
        });
      });
    });
  });
}

// ================= SETTINGS FUNCTIONS =================
async function getSettings() {
  if (usePostgres) {
    return await getSettingsPostgres();
  } else {
    return await getSettingsSQLite();
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
  return new Promise((resolve, reject) => {
    try {
      const keys = Object.keys(defaultSettings);
      const placeholders = keys.map(() => '?').join(',');
      
      db.all(
        `SELECT key, value FROM bot_settings WHERE key IN (${placeholders})`,
        keys,
        (err, rows) => {
          if (err) {
            console.error("❌ Failed to fetch settings from SQLite:", err);
            resolve(defaultSettings);
            return;
          }
          
          const settings = { ...defaultSettings };
          for (const row of rows) {
            settings[row.key] = row.value;
          }
          
          resolve(settings);
        }
      );
    } catch (err) {
      console.error("❌ Error in getSettingsSQLite:", err);
      resolve(defaultSettings);
    }
  });
}

async function updateSetting(key, value) {
  if (usePostgres) {
    return await updateSettingPostgres(key, value);
  } else {
    return await updateSettingSQLite(key, value);
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
  return new Promise((resolve, reject) => {
    try {
      const validKeys = Object.keys(defaultSettings);
      if (!validKeys.includes(key)) {
        reject(new Error(`Invalid setting key: ${key}`));
        return;
      }

      db.run(
        `UPDATE bot_settings SET value = ? WHERE key = ?`,
        [value, key],
        function(err) {
          if (err) {
            console.error("❌ Failed to update setting in SQLite:", err);
            resolve(false);
            return;
          }
          
          if (this.changes === 0) {
            // Insert if doesn't exist
            db.run(
              `INSERT OR IGNORE INTO bot_settings (key, value) VALUES (?, ?)`,
              [key, value],
              (err) => {
                if (err) {
                  console.error("❌ Failed to insert setting in SQLite:", err);
                  resolve(false);
                } else {
                  resolve(true);
                }
              }
            );
          } else {
            resolve(true);
          }
        }
      );
    } catch (err) {
      console.error("❌ Error in updateSettingSQLite:", err);
      resolve(false);
    }
  });
}

// ================= SUDO OWNER FUNCTIONS =================
async function addSudoOwner(number) {
  if (usePostgres) {
    return await addSudoOwnerPostgres(number);
  } else {
    return await addSudoOwnerSQLite(number);
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
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO sudo_owners (number) VALUES (?)`,
      [number],
      (err) => {
        if (err) {
          console.error("❌ Failed to add sudo owner to SQLite:", err);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

async function removeSudoOwner(number) {
  if (usePostgres) {
    return await removeSudoOwnerPostgres(number);
  } else {
    return await removeSudoOwnerSQLite(number);
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
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM sudo_owners WHERE number = ?`,
      [number],
      (err) => {
        if (err) {
          console.error("❌ Failed to remove sudo owner from SQLite:", err);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

async function getSudoOwners() {
  if (usePostgres) {
    return await getSudoOwnersPostgres();
  } else {
    return await getSudoOwnersSQLite();
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
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT number FROM sudo_owners`,
      [],
      (err, rows) => {
        if (err) {
          console.error("❌ Failed to fetch sudo owners from SQLite:", err);
          resolve([]);
        } else {
          resolve(rows.map(r => r.number));
        }
      }
    );
  });
}

async function isSudoOwner(number) {
  if (usePostgres) {
    return await isSudoOwnerPostgres(number);
  } else {
    return await isSudoOwnerSQLite(number);
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
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 1 FROM sudo_owners WHERE number = ?`,
      [number],
      (err, row) => {
        if (err) {
          console.error("❌ Failed to check sudo owner in SQLite:", err);
          resolve(false);
        } else {
          resolve(!!row);
        }
      }
    );
  });
}

// ================= BADWORD FUNCTIONS =================
async function addBadword(word) {
  if (usePostgres) {
    return await addBadwordPostgres(word);
  } else {
    return await addBadwordSQLite(word);
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
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO badwords (word) VALUES (?)`,
      [word.toLowerCase()],
      (err) => {
        if (err) {
          console.error("❌ Failed to add badword to SQLite:", err);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

async function removeBadword(word) {
  if (usePostgres) {
    return await removeBadwordPostgres(word);
  } else {
    return await removeBadwordSQLite(word);
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
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM badwords WHERE word = ?`,
      [word.toLowerCase()],
      (err) => {
        if (err) {
          console.error("❌ Failed to remove badword from SQLite:", err);
          resolve(false);
        } else {
          resolve(true);
        }
      }
    );
  });
}

async function getBadwords() {
  if (usePostgres) {
    return await getBadwordsPostgres();
  } else {
    return await getBadwordsSQLite();
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
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT word FROM badwords`,
      [],
      (err, rows) => {
        if (err) {
          console.error("❌ Failed to fetch badwords from SQLite:", err);
          resolve([]);
        } else {
          resolve(rows.map(r => r.word));
        }
      }
    );
  });
}

// ================= DATABASE BACKUP (SQLite only) =================
function backupSQLiteDatabase() {
  return new Promise((resolve, reject) => {
    if (!usePostgres && db) {
      try {
        const backupPath = path.join(__dirname, `database_backup_${Date.now()}.sqlite`);
        fs.copyFileSync(path.join(__dirname, 'database.sqlite'), backupPath);
        console.log(`✅ SQLite database backed up to: ${backupPath}`);
        resolve(backupPath);
      } catch (err) {
        console.error("❌ Failed to backup SQLite database:", err);
        resolve(null);
      }
    } else {
      resolve(null);
    }
  });
}

// ================= CLOSE CONNECTION =================
async function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (usePostgres && pool) {
      pool.end()
        .then(() => {
          console.log("🔗 PostgreSQL connection closed");
          resolve();
        })
        .catch(err => {
          console.error("❌ Error closing PostgreSQL connection:", err);
          resolve();
        });
    } else if (db) {
      db.close((err) => {
        if (err) {
          console.error("❌ Error closing SQLite connection:", err);
        } else {
          console.log("💾 SQLite connection closed");
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ================= ADDITIONAL UTILITY FUNCTIONS =================
async function getDatabaseStats() {
  if (usePostgres) {
    const client = await pool.connect();
    try {
      const settingsCount = await client.query('SELECT COUNT(*) FROM bot_settings');
      const sudoCount = await client.query('SELECT COUNT(*) FROM sudo_owners');
      const badwordsCount = await client.query('SELECT COUNT(*) FROM badwords');
      
      return {
        type: 'PostgreSQL',
        settings: parseInt(settingsCount.rows[0].count),
        sudo_owners: parseInt(sudoCount.rows[0].count),
        badwords: parseInt(badwordsCount.rows[0].count)
      };
    } catch (err) {
      console.error("❌ Failed to get PostgreSQL stats:", err);
      return { type: 'PostgreSQL', error: err.message };
    } finally {
      client.release();
    }
  } else {
    return new Promise((resolve, reject) => {
      const stats = { type: 'SQLite' };
      
      db.get('SELECT COUNT(*) as count FROM bot_settings', (err, row) => {
        if (err) {
          stats.settings_error = err.message;
        } else {
          stats.settings = row.count;
        }
        
        db.get('SELECT COUNT(*) as count FROM sudo_owners', (err, row) => {
          if (err) {
            stats.sudo_owners_error = err.message;
          } else {
            stats.sudo_owners = row.count;
          }
          
          db.get('SELECT COUNT(*) as count FROM badwords', (err, row) => {
            if (err) {
              stats.badwords_error = err.message;
            } else {
              stats.badwords = row.count;
            }
            
            resolve(stats);
          });
        });
      });
    });
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
  getDatabaseStats,
 
  getDatabaseType: () => usePostgres ? 'postgresql' : 'sqlite'
};
