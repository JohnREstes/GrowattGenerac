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

let pinState = 'OFF'; // This is the state the ESP fetches and browser can toggle

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/espcontrol/socket.io', express.static(path.join(__dirname, 'node_modules', 'socket.io-client', 'dist')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

// Auth Middleware
function isAuthenticated(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login.html');
}

// Routes
app.get('/', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/control', (req, res) => {
  // ESP8266 polls this endpoint every 2 seconds
  res.send(pinState);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    res.send('Invalid credentials. <a href="/login.html">Try again</a>.');
  }
});

// WebSocket
io.on('connection', socket => {
  console.log('New WebSocket client connected');
  socket.emit('state', pinState); // Send current state to new client

  socket.on('toggle', () => {
    pinState = (pinState === 'OFF') ? 'ON' : 'OFF';
    io.emit('state', pinState); // Broadcast new state
  });

  socket.on('set', state => {
    if (state === 'ON' || state === 'OFF') {
      pinState = state;
      io.emit('state', pinState);
    }
  });
});

// Start server
server.listen(port, () => {
  console.log(`ESP Control Server running on http://localhost:${port}`);
});
