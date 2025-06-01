// db/listUsersAndDevices.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath);

const query = `
  SELECT users.id AS user_id, users.username, devices.id AS device_id, devices.device_name
  FROM users
  LEFT JOIN user_devices ON users.id = user_devices.user_id
  LEFT JOIN devices ON user_devices.device_id = devices.id
  ORDER BY users.id;
`;

console.log('--- User to Device Mapping ---');

db.all(query, [], (err, rows) => {
  if (err) {
    console.error('[ERROR] Failed to fetch data:', err.message);
    db.close();
    return;
  }

  if (rows.length === 0) {
    console.log('No users or device mappings found.');
  } else {
    rows.forEach(row => {
      console.log(`User: ${row.username} (ID: ${row.user_id})`);
      if (row.device_id) {
        console.log(`  ↳ Device: ${row.device_name} (ID: ${row.device_id})`);
      } else {
        console.log('  ↳ No linked device.');
      }
    });
  }

  db.close();
});
