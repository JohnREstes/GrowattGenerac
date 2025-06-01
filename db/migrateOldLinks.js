const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'espcontrol.db'));

const migrate = `
INSERT OR IGNORE INTO user_devices (user_id, device_id)
SELECT user_id, id FROM devices WHERE user_id IS NOT NULL;
`;

db.run(migrate, function (err) {
  if (err) {
    console.error('[ERROR] Migration failed:', err.message);
  } else {
    console.log('[SUCCESS] Old user-device links migrated to user_devices table.');
  }
  db.close();
});
