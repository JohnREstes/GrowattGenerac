const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'espcontrol.db');

const db = new sqlite3.Database(dbPath);

// Create users table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )
`, () => console.log('[✅] Users table ready'));

// Create devices table
db.run(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    gpio_pin INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`, () => console.log('[✅] Devices table ready'));

// Create schedules table
db.run(`
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    time TEXT NOT NULL,     -- format: "HH:MM"
    state TEXT NOT NULL,    -- "ON" or "OFF"
    FOREIGN KEY (device_id) REFERENCES devices(id)
  )
`, () => console.log('[✅] Schedules table ready'));

db.run(`
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    time TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('ON', 'OFF')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  )
`, err => {
  if (err) console.error('[ERROR] Failed to create schedules table:', err);
  else console.log('[✅] Schedules table created (or already exists)');
});

// Close DB after setup
db.close();
