const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath);

// Create Users and Schedules tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    timezone TEXT NOT NULL,
    events TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  console.log('[DB] Tables ensured.');
});

db.close();
