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

      db.run(`
        CREATE TABLE IF NOT EXISTS devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          device_name TEXT NOT NULL,
          timezone TEXT DEFAULT 'UTC', -- ✅ NEW COLUMN: timezone
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) console.error('[DB] Error creating devices table:', err.message);
        else console.log('[DB] Devices table ensured.');
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id INTEGER NOT NULL,
          time TEXT NOT NULL, -- e.g., "14:30"
          state TEXT NOT NULL, -- "ON" or "OFF"
          FOREIGN KEY (device_id) REFERENCES devices(id)
        )
      `, (err) => {
        if (err) console.error('[DB] Error creating schedules table:', err.message);
        else console.log('[DB] Schedules table ensured.');
      });

      // Add a default user if none exist
      // This is for initial setup. You can remove this block after your first run.
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