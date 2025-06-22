// db/database.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB] Failed to connect to database:', err);
  } else {
    console.log('[DB] Connected to SQLite database at', dbPath);

    db.serialize(() => {
      // Users
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL
        )
      `);

      // Devices
      db.run(`
        CREATE TABLE IF NOT EXISTS devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          device_name TEXT NOT NULL,
          timezone TEXT DEFAULT 'UTC',
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Legacy schedule_events (optional, can remove if unused)
      db.run(`
        CREATE TABLE IF NOT EXISTS schedule_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          device_id INTEGER NOT NULL,
          timezone TEXT NOT NULL,
          on_time TEXT NOT NULL,
          off_time TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (device_id) REFERENCES devices(id)
        )
      `);

      // ✅ Schedules (used in current index.js routes)
      db.run(`
        CREATE TABLE IF NOT EXISTS schedules (
          device_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          timezone TEXT NOT NULL,
          events_json TEXT NOT NULL,
          PRIMARY KEY (device_id, user_id)
        )
      `);

      // Integrations
      db.run(`
        CREATE TABLE IF NOT EXISTS integrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          integration_type TEXT NOT NULL,
          name TEXT NOT NULL,
          settings_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_active INTEGER DEFAULT 0,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Battery Triggers
      db.run(`
        CREATE TABLE IF NOT EXISTS battery_triggers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          device_id INTEGER NOT NULL,
          inverter_id TEXT NOT NULL,
          metric TEXT NOT NULL,
          turn_on_below REAL NOT NULL,
          turn_off_above REAL NOT NULL,
          is_enabled INTEGER DEFAULT 1,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (device_id) REFERENCES devices(id)
        )
      `);

      // Unique index for trigger upsert logic
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_battery_trigger_per_device
        ON battery_triggers (user_id, device_id, inverter_id, metric)
      `);

      // Create default user + device
      db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
        if (err) return console.error('[DB] Error checking for default user:', err.message);
        if (row.count === 0) {
          const username = 'admin';
          const password = 'password123'; // ⚠️ Change in production
          bcrypt.hash(password, 10, (err, hash) => {
            if (err) return console.error('[DB] Error hashing password:', err.message);
            db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], function (err) {
              if (err) return console.error('[DB] Error inserting default user:', err.message);
              const userId = this.lastID;
              db.run(`INSERT INTO devices (user_id, device_name, timezone) VALUES (?, ?, ?)`,
                [userId, 'My ESP Device', 'America/Cancun'],
                function (err) {
                  if (err) console.error('[DB] Error inserting default device:', err.message);
                  else console.log(`[DB] Default device created with ID: ${this.lastID}`);
                });
            });
          });
        }
      });
    });
  }
});

module.exports = db;
