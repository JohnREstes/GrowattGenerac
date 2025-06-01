// db/checkDeviceOwnership.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath);

const query = `SELECT id, device_name, user_id FROM devices ORDER BY id`;

console.log('--- Devices Table ---');

db.all(query, [], (err, rows) => {
  if (err) {
    console.error('[ERROR] Failed to fetch devices:', err.message);
    db.close();
    return;
  }

  if (rows.length === 0) {
    console.log('No devices found.');
  } else {
    rows.forEach(row => {
      console.log(`Device: ${row.device_name} (ID: ${row.id}) → user_id: ${row.user_id}`);
    });
  }

  db.close();
});
