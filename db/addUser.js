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

rl.question('Username: ', username => {
  rl.question('Password: ', password => {
    const saltRounds = 10;
    bcrypt.hash(password, saltRounds, (err, hashed) => {
      if (err) {
        console.error('[ERROR] Failed to hash password:', err);
        rl.close();
        db.close();
        return;
      }

      const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
      stmt.run(username, hashed, function (err) {
        if (err) {
          console.error('[ERROR] Failed to add user:', err.message);
        } else {
          console.log(`[SUCCESS] User '${username}' added with ID ${this.lastID}`);
        }

        stmt.finalize(() => {
          rl.close();
          db.close();
        });
      });
    });
  });
});
