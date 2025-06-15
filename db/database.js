// db/database.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt'); // Needed for hashing default user password

// Ensure the path to your DB is correct
const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB] Failed to connect to database:', err);
  } else {
    console.log('[DB] Connected to SQLite database at', dbPath);

    // Create tables if they don't exist
    db.serialize(() => {
      // Users Table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL
        )
      `, (err) => {
        if (err) console.error('[DB] Error creating users table:', err.message);
        else console.log('[DB] Users table ensured.');
      });

      // Devices Table
      db.run(`
        CREATE TABLE IF NOT EXISTS devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          device_name TEXT NOT NULL,
          timezone TEXT DEFAULT 'UTC',
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) console.error('[DB] Error creating devices table:', err.message);
        else console.log('[DB] Devices table ensured.');
      });

      // Schedules Table (Corrected with events_json column)
      db.run(`
        CREATE TABLE IF NOT EXISTS schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          timezone TEXT NOT NULL,
          events_json TEXT NOT NULL,
          FOREIGN KEY (device_id) REFERENCES devices(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) console.error('[DB] Error creating schedules table:', err.message);
        else console.log('[DB] Schedules table ensured.');
      });

      // Integrations Table (for Growatt and other future integrations)
      db.run(`
        CREATE TABLE IF NOT EXISTS integrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          integration_type TEXT NOT NULL, /* e.g., 'Growatt' */
          name TEXT NOT NULL,
          settings_json TEXT NOT NULL, /* Stores integration-specific settings as JSON */
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) console.error('[DB] Error creating integrations table:', err.message);
        else console.log('[DB] Integrations table ensured.');
      });

      // Add a default admin user and device if no users exist
      // You should remove this block after your first run, or change the default password!
      db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
        if (err) {
          console.error('[DB] Error checking for default user:', err.message);
          return;
        }
        if (row.count === 0) {
          const defaultUsername = 'admin';
          const defaultPassword = 'password123'; // CHANGE THIS TO A SECURE PASSWORD!
          bcrypt.hash(defaultPassword, 10, (err, hash) => {
            if (err) {
              console.error('[DB] Error hashing password for default user:', err.message);
              return;
            }
            db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [defaultUsername, hash], function(err) {
              if (err) {
                console.error('[DB] Error inserting default user:', err.message);
              } else {
                console.log(`[DB] Default user '${defaultUsername}' added with ID: ${this.lastID}`);
                // Add a default device for the admin user
                db.run(`INSERT INTO devices (user_id, device_name, timezone) VALUES (?, ?, ?)`, [this.lastID, 'My ESP Device', 'America/Cancun'], function(err) {
                    if (err) console.error('[DB] Error inserting default device:', err.message);
                    else console.log(`[DB] Default device 'My ESP Device' added with ID: ${this.lastID}`);
                });
              }
            });
          });
        }
      });
    });
  }
});

module.exports = db;