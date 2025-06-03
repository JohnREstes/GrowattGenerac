// db/deleteUser.js
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('--- Delete User and Associated Data ---');

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

    db.serialize(() => {
      // Delete user's devices and their schedules first due to foreign key constraints
      db.run(`DELETE FROM schedules WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?)`, [userId], function (err) {
        if (err) {
          console.error('[ERROR] Failed to delete user\'s schedules:', err.message);
          return;
        }
        console.log(`[INFO] Deleted ${this.changes} schedules for user ${username}.`);
      });

      db.run(`DELETE FROM devices WHERE user_id = ?`, [userId], function (err) {
        if (err) {
          console.error('[ERROR] Failed to delete user\'s devices:', err.message);
          return;
        }
        console.log(`[INFO] Deleted ${this.changes} devices for user ${username}.`);
      });

      // Finally, delete the user
      db.run(`DELETE FROM users WHERE id = ?`, [userId], function (err) {
        if (err) {
          console.error('[ERROR] Failed to delete user:', err.message);
        } else {
          console.log(`[SUCCESS] Deleted user '${username}' (ID: ${userId})`);
        }
        rl.close();
        db.close();
      });
    });
  });
});