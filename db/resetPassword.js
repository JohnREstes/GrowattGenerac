// db/resetPassword.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const readline = require('readline');
const path = require('path');

const dbPath = path.join(__dirname, 'espcontrol.db');
const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Username to reset password: ', username => {
  rl.question('New password: ', async newPassword => {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const query = `UPDATE users SET password = ? WHERE username = ?`;
    db.run(query, [hashedPassword, username], function (err) {
      if (err) {
        console.error('[❌] Failed to reset password:', err.message);
      } else if (this.changes === 0) {
        console.warn('[⚠️] No user found with that username.');
      } else {
        console.log(`[✅] Password updated for user '${username}'`);
      }

      db.close();
      rl.close();
    });
  });
});

