// db/listUsersAndDevices.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath);

console.log('\n--- User to Device Mapping ---');

db.all('SELECT * FROM users', [], (err, users) => {
  if (err) {
    console.error('[ERROR] Failed to fetch users:', err.message);
    db.close();
    return;
  }

  users.forEach(user => {
    console.log(`User: ${user.username} (ID: ${user.id})`);
    db.all(
      'SELECT * FROM devices WHERE user_id = ?',
      [user.id],
      (err, devices) => {
        if (err) {
          console.error('[ERROR] Failed to fetch devices:', err.message);
          return;
        }

        if (devices.length === 0) {
          console.log('  ↳ No linked device.');
        } else {
          devices.forEach(device => {
            console.log(
              `  ↳ Device: ${device.device_name} (ID: ${device.id}, GPIO: ${device.gpio_pin})`
            );
          });
        }
      }
    );
  });

  setTimeout(() => db.close(), 500); // Delay to let async logs complete
});
