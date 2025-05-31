require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  path: '/espcontrol/socket.io'
});

const port = 3020;

// Load credentials from .env
const SESSION_SECRET = process.env.SESSION_SECRET;
const LOGIN_USERNAME = process.env.LOGIN_USERNAME;
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;

let pinState = 'OFF';

// Middleware
console.log('[INIT] Registering middleware...');
app.use(express.static(path.join(__dirname, 'public')));
console.log(`[STATIC] Serving /public from: ${path.join(__dirname, 'public')}`);

// HTTP Request Logger
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// Serve static socket.io-client files with logging
app.use('/espcontrol/socket.io', (req, res, next) => {
  console.log(`[STATIC SOCKET.IO] ${req.method} ${req.url}`);
  next();
}, express.static(path.join(__dirname, 'node_modules', 'socket.io-client', 'dist')));

// Explicit socket.io.js route with logging
app.get('/espcontrol/socket.io/socket.io.js', (req, res) => {
  const filePath = path.join(__dirname, 'node_modules', 'socket.io-client', 'dist', 'socket.io.js');
  console.log(`[SERVE] socket.io.js requested. Path: ${filePath}`);
  res.sendFile(filePath);
});

// Body + session middleware
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

// Auth middleware
function isAuthenticated(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login.html');
}

// Routes
app.get('/', isAuthenticated, (req, res) => {
  console.log('[GET] / -> Serving index.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/control', (req, res) => {
  console.log('[GET] /control -> Returning pinState:', pinState);
  res.send(pinState);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  console.log(`[LOGIN] Attempt with username: ${username}`);
  if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
    console.log('[LOGIN] Success');
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    console.log('[LOGIN] Failed');
    res.send('Invalid credentials. <a href="/login.html">Try again</a>.');
  }
});

// WebSocket
io.on('connection', socket => {
  console.log(`[SOCKET.IO] New client connected: ${socket.id}`);
  socket.emit('state', pinState);

  socket.on('toggle', () => {
    pinState = (pinState === 'OFF') ? 'ON' : 'OFF';
    console.log(`[SOCKET.IO] State toggled to: ${pinState}`);
    io.emit('state', pinState);
  });

  socket.on('set', state => {
    if (state === 'ON' || state === 'OFF') {
      pinState = state;
      console.log(`[SOCKET.IO] State explicitly set to: ${pinState}`);
      io.emit('state', pinState);
    }
  });

  socket.on('disconnect', reason => {
    console.log(`[SOCKET.IO] Client disconnected: ${socket.id}, Reason: ${reason}`);
  });

  socket.on('error', err => {
    console.error(`[SOCKET.IO] Error on socket ${socket.id}:`, err);
  });
});

// Start server
server.listen(port, () => {
  console.log(`[STARTED] ESP Control Server running at http://localhost:${port}`);
});
