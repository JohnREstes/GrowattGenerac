//index.js

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http'); // Still needed for creating the server
// const socketIo = require('socket.io'); // REMOVED: No longer using Socket.IO
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db/database');

const app = express();
const server = http.createServer(app);

const fs = require('fs');

const port = 3020;

const SESSION_SECRET = process.env.SESSION_SECRET;

const deviceStates = {}; // Example: { "1": "ON", "2": "OFF" }

// const io = socketIo(server, { // REMOVED: No longer initializing Socket.IO
//   path: '/espcontrol/socket.io'
// });

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

// ✅ PUBLIC endpoint for ESP to poll GPIO state
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
  // Removed socket.io path allowance as it's no longer used
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

// Removed: No longer serving socket.io.js explicitly
// app.get('/espcontrol/socket.io/socket.io.js', (req, res) => {
//   const filePath = path.join(__dirname, 'node_modules', 'socket.io-client', 'dist', 'socket.io.js');
//   console.log(`[SERVE] socket.io.js requested. Path: ${filePath}`);
//   res.sendFile(filePath);
// });

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

// REMOVED: All WebSocket logic as it's no longer used
// io.on('connection', socket => { ... });

// Get schedule for a specific device
app.get('/espcontrol/api/schedule/:deviceId', isAuthenticated, (req, res) => {
  const deviceId = req.params.deviceId;
  db.all(
    `SELECT time, state FROM schedules WHERE device_id = ? ORDER BY time`,
    [deviceId],
    (err, rows) => {
      if (err) {
        console.error('[SCHEDULE] DB read error:', err);
        return res.status(500).send('Failed to load schedule.');
      }
      res.json(rows); // Return just the rows, not an object with 'events' key
    }
  );
});

// Save schedule for a specific device
app.post('/espcontrol/api/schedule/:deviceId', isAuthenticated, express.json(), (req, res) => {
  const deviceId = req.params.deviceId;
  const { events } = req.body;

  if (!Array.isArray(events)) {
    return res.status(400).send('Invalid format');
  }

  db.serialize(() => {
    db.run(`DELETE FROM schedules WHERE device_id = ?`, [deviceId]);

    const stmt = db.prepare(`INSERT INTO schedules (device_id, time, state) VALUES (?, ?, ?)`);
    for (const event of events) {
      if (event.time && (event.state === 'ON' || event.state === 'OFF')) {
        stmt.run(deviceId, event.time, event.state);
      }
    }
    stmt.finalize(err => {
      if (err) {
        console.error('[SCHEDULE] Failed to save:', err);
        return res.status(500).send('Failed to save schedule');
      }
      console.log(`[SCHEDULE] Updated schedule for device ${deviceId}`);
      res.send('Schedule updated');
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

// Start the server
server.listen(port, () => {
  console.log(`[STARTED] ESP Control Server running at http://localhost:${port}`);
});