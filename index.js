//index.js

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db/database');
const cron = require('node-cron'); // NEW: For scheduling tasks
const moment = require('moment'); // NEW: For date/time handling
const momentTz = require('moment-timezone'); // NEW: For timezone handling

const app = express();
const server = http.createServer(app);

const fs = require('fs');

const port = 3020;

const SESSION_SECRET = process.env.SESSION_SECRET;

const deviceStates = {}; // Example: { "1": "ON", "2": "OFF" } - now updated by schedule

// Store loaded schedules in memory for quick access
// Format: { deviceId: [{ time: "HH:MM", state: "ON/OFF" }, ...], ... }
const loadedSchedules = {};
// Store timezone for each device
// Format: { deviceId: "America/Cancun" }
const deviceTimezones = {};

// Body + session middleware
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 2 * 60 * 60 * 1000 } // 2 hours
}));

app.use(express.json());

// Auth check function
function isAuthenticated(req, res, next) {
  if (req.session.loggedIn) return next();
  console.log('[AUTH] Redirecting unauthenticated request to login');
  res.redirect('/espcontrol/login.html');
}

// Log all requests
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// ✅ PUBLIC endpoint for ESP to poll GPIO state (UPDATED to match client and JSON)
app.get('/espcontrol/control', (req, res) => {
  const deviceId = req.query.deviceId; // Changed from device_id to deviceId to match script.js
  if (!deviceId) {
    return res.status(400).json({ error: 'Missing deviceId' }); // Return JSON error
  }

  const state = deviceStates[deviceId] || 'OFF';
  console.log(`[GET] /espcontrol/control?deviceId=${deviceId} -> ${state}`);
  res.json({ deviceId, state }); // Return JSON object
});

// ✅ New endpoint to handle device state toggling via HTTP POST
app.post('/espcontrol/control', isAuthenticated, express.json(), (req, res) => {
  const { deviceId, state } = req.body;
  if (!deviceId || (state !== 'ON' && state !== 'OFF')) {
    return res.status(400).json({ error: 'Invalid deviceId or state' });
  }

  deviceStates[deviceId] = state;
  console.log(`[POST] /espcontrol/control -> Device ${deviceId} set to ${state}`);
  // In a polling system, the ESP will pick this up on its next poll
  res.json({ message: `Device ${deviceId} set to ${state}`, deviceId, state });
});


// Serve static files under /espcontrol, with session protection
app.use('/espcontrol', (req, res, next) => {
  // Removed socket.io path check as we are no longer using it for control
  if (
    req.path === '/login.html' ||
    req.path === '/login' ||
    req.path === '/logout'
  ) return next(); // Allow login/logout
  if (req.session.loggedIn) {
    return express.static(path.join(__dirname, 'public'))(req, res, next);
  }
  console.log('[AUTH] Blocked static file request:', req.originalUrl);
  res.redirect('/espcontrol/login.html');
});

// Removed explicit socket.io.js serving as it's no longer used for control

// Login page
app.get('/espcontrol/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login handler using SQLite
app.post('/espcontrol/login', (req, res) => {
  const { username, password } = req.body;
  console.log(`[LOGIN] Attempt with username: ${username}`);

  const query = `SELECT * FROM users WHERE username = ?`;
  db.get(query, [username], (err, user) => {
    if (err) {
      console.error('[LOGIN] DB error:', err);
      return res.send('Server error. Please try again later.');
    }

    if (!user) {
      console.log('[LOGIN] User not found');
      return res.send('Invalid username or password. <a href="/espcontrol/login.html">Try again</a>.');
    }

    bcrypt.compare(password, user.password, (err, result) => {
      if (err) {
        console.error('[LOGIN] Bcrypt error:', err);
        return res.send('Server error. Please try again later.');
      }

      if (result) {
        console.log('[LOGIN] Success');
        req.session.loggedIn = true;
        req.session.userId = user.id;
        res.redirect('/espcontrol/');
      } else {
        console.log('[LOGIN] Invalid password');
        res.send('Invalid username or password. <a href="/espcontrol/login.html">Try again</a>.');
      }
    });
  });
});

// Logout handler
app.get('/espcontrol/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/espcontrol/login.html');
  });
});

// Redirect root to /espcontrol
app.get('/', (req, res) => {
  res.redirect('/espcontrol/');
});

// Protected index route
app.get('/espcontrol/', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get schedule for a specific device (UPDATED to fetch timezone)
app.get('/espcontrol/api/schedule/:deviceId', isAuthenticated, (req, res) => {
  const deviceId = req.params.deviceId;
  db.get(`SELECT timezone FROM devices WHERE id = ?`, [deviceId], (err, row) => {
    if (err) {
      console.error('[SCHEDULE] DB read timezone error:', err);
      // Even if timezone fails, try to return schedule
      return res.status(500).send('Failed to load device timezone.'); 
    }
    const timezone = row ? row.timezone : 'UTC'; // Default to UTC if not set

    db.all(
      `SELECT time, state FROM schedules WHERE device_id = ? ORDER BY time`,
      [deviceId],
      (err, rows) => {
        if (err) {
          console.error('[SCHEDULE] DB read schedule error:', err);
          return res.status(500).send('Failed to load schedule.');
        }
        res.json({ events: rows, timezone: timezone }); // Return both events and timezone
      }
    );
  });
});

// Save schedule for a specific device (UPDATED to save timezone)
app.post('/espcontrol/api/schedule/:deviceId', isAuthenticated, express.json(), (req, res) => {
  const deviceId = req.params.deviceId;
  const { events, timezone } = req.body; // NEW: timezone also sent from client

  if (!Array.isArray(events)) {
    return res.status(400).send('Invalid format');
  }

  db.serialize(() => {
    // Update device timezone
    db.run(`UPDATE devices SET timezone = ? WHERE id = ?`, [timezone, deviceId], function(err) {
      if (err) {
        console.error('[SCHEDULE] Failed to save timezone:', err);
        return res.status(500).send('Failed to save device timezone.');
      }
      console.log(`[SCHEDULE] Updated timezone for device ${deviceId} to ${timezone}`);
    });

    // Clear existing schedule
    db.run(`DELETE FROM schedules WHERE device_id = ?`, [deviceId], function(err) {
      if (err) {
        console.error('[SCHEDULE] Failed to clear old schedule:', err);
        return res.status(500).send('Failed to clear old schedule.');
      }

      // Insert new schedule events
      const stmt = db.prepare(`INSERT INTO schedules (device_id, time, state) VALUES (?, ?, ?)`);
      for (const event of events) {
        if (event.time && (event.state === 'ON' || event.state === 'OFF')) {
          stmt.run(deviceId, event.time, event.state);
        }
      }
      stmt.finalize(err => {
        if (err) {
          console.error('[SCHEDULE] Failed to save new schedule:', err);
          return res.status(500).send('Failed to save schedule');
        }
        console.log(`[SCHEDULE] Updated schedule for device ${deviceId}`);
        loadAllSchedules(); // Reload all schedules after a save
        res.send('Schedule updated');
      });
    });
  });
});

app.get('/espcontrol/api/devices', isAuthenticated, (req, res) => {
  const userId = req.session.userId;
  db.all(
    `SELECT id, device_name FROM devices WHERE user_id = ?`,
    [userId],
    (err, rows) => {
      if (err) {
        console.error('[DEVICES] DB read error:', err);
        return res.status(500).send('Failed to load devices.');
      }
      res.json(rows);
    }
  );
});

// NEW SCHEDULING LOGIC BELOW

// Function to load all schedules from the database
function loadAllSchedules() {
  console.log('[SCHEDULER] Loading all schedules from database...');
  db.all(
    `SELECT s.device_id, s.time, s.state, d.timezone
     FROM schedules s
     JOIN devices d ON s.device_id = d.id`,
    (err, rows) => {
      if (err) {
        console.error('[SCHEDULER] Error loading schedules:', err);
        return;
      }

      // Clear previous schedules
      for (const deviceId in loadedSchedules) {
        delete loadedSchedules[deviceId];
      }
      for (const deviceId in deviceTimezones) {
        delete deviceTimezones[deviceId];
      }

      rows.forEach(row => {
        if (!loadedSchedules[row.device_id]) {
          loadedSchedules[row.device_id] = [];
        }
        loadedSchedules[row.device_id].push({ time: row.time, state: row.state });
        deviceTimezones[row.device_id] = row.timezone || 'UTC'; // Store timezone
      });
      console.log(`[SCHEDULER] Loaded schedules for ${Object.keys(loadedSchedules).length} devices.`);
      // console.log("Loaded schedules:", loadedSchedules); // Uncomment for debugging
    }
  );
}

// Function to check schedules and execute actions
function checkSchedules() {
  const now = moment(); // Current time in system's local timezone
  
  for (const deviceId in loadedSchedules) {
    const schedules = loadedSchedules[deviceId];
    const deviceTz = deviceTimezones[deviceId]; // Get timezone for this device

    if (!momentTz.tz.zone(deviceTz)) {
        console.error(`[SCHEDULER] Invalid timezone for device ${deviceId}: ${deviceTz}. Skipping schedule check.`);
        continue;
    }

    const nowInDeviceTz = momentTz.tz(now, deviceTz); // Convert current time to device's timezone
    const currentMinuteOfDay = nowInDeviceTz.hours() * 60 + nowInDeviceTz.minutes();

    schedules.forEach(event => {
      const [hour, minute] = event.time.split(':').map(Number);
      const eventMinuteOfDay = hour * 60 + minute;

      // Check if the scheduled time matches the current minute in the device's timezone
      if (currentMinuteOfDay === eventMinuteOfDay) {
        // Prevent multiple triggers within the same minute
        const lastTriggerKey = `${deviceId}-${event.time}-${event.state}`;
        const lastTriggerMinute = global.lastScheduleTriggeredMinute || {};
        
        if (lastTriggerMinute[lastTriggerKey] !== currentMinuteOfDay) {
          console.log(`[SCHEDULER] Executing scheduled event for device ${deviceId} at ${nowInDeviceTz.format('HH:mm z')} (target: ${event.time}): set to ${event.state}`);
          deviceStates[deviceId] = event.state; // Update the in-memory state
          // Store that this schedule was triggered for this minute
          lastTriggerMinute[lastTriggerKey] = currentMinuteOfDay;
          global.lastScheduleTriggeredMinute = lastTriggerMinute; // Save globally
        } else {
          // console.log(`[SCHEDULER] Skipping duplicate trigger for device ${deviceId} at ${event.time}`);
        }
      }
    });
  }
}

// Initialize an object to keep track of the last minute a schedule was triggered
// This prevents multiple triggers if cron runs slightly off or if execution takes time
global.lastScheduleTriggeredMinute = {};


// Load schedules on server start
loadAllSchedules();

// Schedule a cron job to check schedules every minute
cron.schedule('* * * * *', () => { // Runs every minute
  checkSchedules();
});

// Start the server
server.listen(port, () => {
  console.log(`[STARTED] ESP Control Server running at http://localhost:${port}`);
  console.log(`[SCHEDULER] Cron job scheduled to check schedules every minute.`);
});