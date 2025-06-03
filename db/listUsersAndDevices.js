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

  // Use a Promise.all or async/await to ensure all device fetches complete before closing DB
  const promises = users.map(user => {
    return new Promise((resolve, reject) => {
      console.log(`User: ${user.username} (ID: ${user.id})`);
      db.all(
        'SELECT * FROM devices WHERE user_id = ?',
        [user.id],
        (err, devices) => {
          if (err) {
            console.error('[ERROR] Failed to fetch devices:', err.message);
            reject(err);
            return;
          }

          if (devices.length === 0) {
            console.log('  ↳ No linked device.');
          } else {
            devices.forEach(device => {
              // Removed GPIO: ${device.gpio_pin} as it's no longer in the schema
              console.log(
                `  ↳ Device: ${device.device_name} (ID: ${device.id})`
              );
            });
          }
          resolve();
        }
      );
    });
  });

  Promise.all(promises)
    .finally(() => { // Ensure DB is closed after all ops
      db.close();
    });
});