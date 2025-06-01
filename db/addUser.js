// db/addUser.js
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('--- Add New User ---');
rl.question('Username: ', username => {
  rl.question('Password: ', password => {
    rl.question('Device ID to assign: ', deviceId => {
      const saltRounds = 10;
      bcrypt.hash(password, saltRounds, (err, hashed) => {
        if (err) {
          console.error('[ERROR] Failed to hash password:', err);
          rl.close();
          db.close();
          return;
        }

        const insertUser = 'INSERT INTO users (username, password) VALUES (?, ?)';
        db.run(insertUser, [username, hashed], function (err) {
          if (err) {
            console.error('[ERROR] Failed to add user:', err.message);
            rl.close();
            db.close();
            return;
          }

          const userId = this.lastID;
          console.log(`[SUCCESS] User '${username}' added with ID ${userId}`);

          const insertUserDevice = 'INSERT INTO user_devices (user_id, device_id) VALUES (?, ?)';
          db.run(insertUserDevice, [userId, deviceId], function (err) {
            if (err) {
              console.error('[ERROR] Failed to link user to device:', err.message);
            } else {
              console.log(`[SUCCESS] Linked user ${userId} to device ${deviceId}`);
            }

            rl.close();
            db.close();
          });
        });
      });
    });
  });
});
