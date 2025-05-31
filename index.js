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

// Body + session middleware
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

// Auth protection middleware
app.use('/espcontrol', (req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next(); // Allow socket path
  if (req.session.loggedIn) return next();
  console.log('[AUTH] Blocked unauthenticated access to:', req.originalUrl);
  return res.redirect('/login.html');
});

// Serve static assets AFTER auth check
console.log('[INIT] Registering static route...');
app.use((req, res, next) => {
  if (req.session.loggedIn) {
    express.static(path.join(__dirname, 'public'))(req, res, next);
  } else if (req.path === '/login.html' || req.path === '/login' || req.path.startsWith('/espcontrol/socket.io')) {
    next(); // Allow login and socket
  } else {
    console.log('[AUTH] Redirecting unauthenticated access to login');
    res.redirect('/login.html');
  }
});

console.log(`[STATIC] Serving /public from: ${path.join(__dirname, 'public')}`);

// HTTP request logger
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// Serve socket.io.js explicitly
app.get('/espcontrol/socket.io/socket.io.js', (req, res) => {
  const filePath = path.join(__dirname, 'node_modules', 'socket.io-client', 'dist', 'socket.io.js');
  console.log(`[SERVE] socket.io.js requested. Path: ${filePath}`);
  res.sendFile(filePath);
});

// Routes
app.get('/', (req, res) => {
  res.redirect('/espcontrol/');
});

app.get('/espcontrol/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  console.log(`[LOGIN] Attempt with username: ${username}`);
  if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
    console.log('[LOGIN] Success');
    req.session.loggedIn = true;
    res.redirect('/espcontrol/');
  } else {
    console.log('[LOGIN] Failed');
    res.send('Invalid credentials. <a href="/login.html">Try again</a>.');
  }
});

// Optional: logout route
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

app.get('/control', (req, res) => {
  console.log('[GET] /control -> Returning pinState:', pinState);
  res.send(pinState);
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
