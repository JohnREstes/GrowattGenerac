const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Ensure the path to your DB is correct
const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[DB] Failed to connect to database:', err);
  } else {
    console.log('[DB] Connected to SQLite database at', dbPath);
  }
});

module.exports = db;
