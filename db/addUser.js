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

console.log('--- Add New User and Device ---');

rl.question('Username: ', username => {
  rl.question('Password: ', password => {
    rl.question('Device name to assign: ', deviceName => {
      // Removed: 'GPIO pin to assign (e.g., D0): '
      const saltRounds = 10;
      bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
        if (err) {
          console.error('[ERROR] Failed to hash password:', err);
          rl.close();
          db.close();
          return;
        }

        // Step 1: Add user
        const insertUserSQL = 'INSERT INTO users (username, password) VALUES (?, ?)';
        db.run(insertUserSQL, [username, hashedPassword], function (err) {
          if (err) {
            console.error('[ERROR] Failed to add user:', err.message);
            rl.close();
            db.close();
            return;
          }

          const userId = this.lastID;
          console.log(`[SUCCESS] User '${username}' added with ID ${userId}`);

          // Step 2: Add device (auto ID), linking directly via user_id
          // Removed gpio_pin column
          const insertDeviceSQL = 'INSERT INTO devices (device_name, user_id) VALUES (?, ?)';
          db.run(insertDeviceSQL, [deviceName, userId], function (err) {
            if (err) {
              console.error('[ERROR] Failed to add device:', err.message);
            } else {
              const newDeviceId = this.lastID;
              console.log(`[SUCCESS] Device '${deviceName}' added with ID ${newDeviceId}, linked to user ${userId}`);
            }

            rl.close();
            db.close();
          });
        });
      });
    });
  });
});