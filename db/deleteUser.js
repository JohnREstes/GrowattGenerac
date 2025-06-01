const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('--- Delete User and Device Link ---');

rl.question('Username to delete: ', username => {
  db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
    if (err) {
      console.error('[ERROR] DB error:', err.message);
      rl.close();
      db.close();
      return;
    }

    if (!user) {
      console.log(`[INFO] No user found with username '${username}'`);
      rl.close();
      db.close();
      return;
    }

    const userId = user.id;

    db.all(`SELECT device_id FROM user_devices WHERE user_id = ?`, [userId], (err, rows) => {
      if (err) {
        console.error('[ERROR] Failed to find linked devices:', err.message);
        rl.close();
        db.close();
        return;
      }

      const deviceIds = rows.map(r => r.device_id);

      db.serialize(() => {
        db.run(`DELETE FROM user_devices WHERE user_id = ?`, [userId]);
        db.run(`DELETE FROM users WHERE id = ?`, [userId], function (err) {
          if (err) {
            console.error('[ERROR] Failed to delete user:', err.message);
          } else {
            console.log(`[SUCCESS] Deleted user '${username}' (ID: ${userId})`);
          }
        });

        // Optionally delete unlinked devices
        deviceIds.forEach(deviceId => {
          db.get(`SELECT COUNT(*) AS count FROM user_devices WHERE device_id = ?`, [deviceId], (err, result) => {
            if (err) {
              console.error('[ERROR] Checking device link count failed:', err.message);
              return;
            }

            if (result.count === 0) {
              db.run(`DELETE FROM devices WHERE id = ?`, [deviceId], err => {
                if (err) {
                  console.error(`[ERROR] Failed to delete unlinked device ${deviceId}:`, err.message);
                } else {
                  console.log(`[INFO] Device ${deviceId} was unlinked from all users and deleted.`);
                }
              });
            }
          });
        });
      });

      rl.close();
    });
  });
});
