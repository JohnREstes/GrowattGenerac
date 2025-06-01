const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');
const path = require('path');
const dbPath = path.join(__dirname, 'espcontrol.db');

const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function run() {
  try {
    const username = await ask('Username (to attach device to): ');
    const deviceName = await ask('Device name: ');
    const gpio = await ask('GPIO pin (default 0): ');

    // Lookup user ID
    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, user) => {
      if (err) return console.error('[DB ERROR]', err);
      if (!user) {
        console.error('[❌] User not found.');
        return rl.close();
      }

      const gpioPin = parseInt(gpio) || 0;
      db.run(`INSERT INTO devices (user_id, name, gpio_pin) VALUES (?, ?, ?)`, 
        [user.id, deviceName, gpioPin],
        function (err) {
          if (err) {
            console.error('[❌] Failed to add device:', err.message);
          } else {
            console.log(`[✅] Device '${deviceName}' added for user '${username}' (Device ID: ${this.lastID})`);
          }
          rl.close();
          db.close();
        }
      );
    });
  } catch (err) {
    console.error('[ERROR]', err);
    rl.close();
    db.close();
  }
}

run();
