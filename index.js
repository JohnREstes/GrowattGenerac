//index.js

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db/database');
const cron = require('node-cron');
const moment = require('moment');
const momentTz = require('moment-timezone');

const app = express();
const server = http.createServer(app);

const fs = require('fs');

const port = 3020;

const SESSION_SECRET = process.env.SESSION_SECRET;

const deviceStates = {};
const loadedSchedules = {};
const deviceTimezones = {};

// ✅ NEW: Import the Growatt Integration module
const GrowattIntegration = require('./integrations/growatt');

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
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ error: 'Missing deviceId' });
    }

    const state = deviceStates[deviceId] || 'OFF';
    console.log(`[GET] /espcontrol/control?deviceId=${deviceId} -> ${state}`);
    res.json({ deviceId, state });
});

// ✅ New endpoint to handle device state toggling via HTTP POST
app.post('/espcontrol/control', isAuthenticated, express.json(), (req, res) => {
    const { deviceId, state } = req.body;
    if (!deviceId || (state !== 'ON' && state !== 'OFF')) {
        return res.status(400).json({ error: 'Invalid deviceId or state' });
    }

    deviceStates[deviceId] = state;
    console.log(`[POST] /espcontrol/control -> Device ${deviceId} set to ${state}`);
    res.json({ message: `Device ${deviceId} set to ${state}`, deviceId, state });
});

// Serve static files under /espcontrol, with session protection
app.use('/espcontrol', (req, res, next) => {
    if (
        req.path === '/login.html' ||
        req.path === '/login' ||
        req.path === '/logout'
    ) return next();
    if (req.session.loggedIn) {
        return express.static(path.join(__dirname, 'public'))(req, res, next);
    }
    console.log('[AUTH] Blocked static file request:', req.originalUrl);
    res.redirect('/espcontrol/login.html');
});

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
            return res.status(500).send('Failed to load device timezone.');
        }
        const timezone = row ? row.timezone : 'UTC';

        db.all(
            `SELECT time, state FROM schedules WHERE device_id = ? ORDER BY time`,
            [deviceId],
            (err, rows) => {
                if (err) {
                    console.error('[SCHEDULE] DB read schedule error:', err);
                    return res.status(500).send('Failed to load schedule.');
                }
                res.json({ events: rows, timezone: timezone });
            }
        );
    });
});

// Save schedule for a specific device (UPDATED to save timezone)
app.post('/espcontrol/api/schedule/:deviceId', isAuthenticated, express.json(), (req, res) => {
    const deviceId = req.params.deviceId;
    const { events, timezone } = req.body;

    if (!Array.isArray(events)) {
        return res.status(400).send('Invalid format');
    }

    db.serialize(() => {
        db.run(`UPDATE devices SET timezone = ? WHERE id = ?`, [timezone, deviceId], function(err) {
            if (err) {
                console.error('[SCHEDULE] Failed to save timezone:', err);
                return res.status(500).send('Failed to save device timezone.');
            }
            console.log(`[SCHEDULE] Updated timezone for device ${deviceId} to ${timezone}`);
        });

        db.run(`DELETE FROM schedules WHERE device_id = ?`, [deviceId], function(err) {
            if (err) {
                console.error('[SCHEDULE] Failed to clear old schedule:', err);
                return res.status(500).send('Failed to clear old schedule.');
            }

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
                loadAllSchedules();
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
                deviceTimezones[row.device_id] = row.timezone || 'UTC';
            });
            console.log(`[SCHEDULER] Loaded schedules for ${Object.keys(loadedSchedules).length} devices.`);
        }
    );
}

function checkSchedules() {
    const now = moment();

    for (const deviceId in loadedSchedules) {
        const schedules = loadedSchedules[deviceId];
        const deviceTz = deviceTimezones[deviceId];

        if (!momentTz.tz.zone(deviceTz)) {
            console.error(`[SCHEDULER] Invalid timezone for device ${deviceId}: ${deviceTz}. Skipping schedule check.`);
            continue;
        }

        const nowInDeviceTz = momentTz.tz(now, deviceTz);
        const currentMinuteOfDay = nowInDeviceTz.hours() * 60 + nowInDeviceTz.minutes();

        schedules.forEach(event => {
            const [hour, minute] = event.time.split(':').map(Number);
            const eventMinuteOfDay = hour * 60 + minute;

            if (currentMinuteOfDay === eventMinuteOfDay) {
                const lastTriggerKey = `${deviceId}-${event.time}-${event.state}`;
                const lastTriggerMinute = global.lastScheduleTriggeredMinute || {};

                if (lastTriggerMinute[lastTriggerKey] !== currentMinuteOfDay) {
                    console.log(`[SCHEDULER] Executing scheduled event for device ${deviceId} at ${nowInDeviceTz.format('HH:mm z')} (target: ${event.time}): set to ${event.state}`);
                    deviceStates[deviceId] = event.state;
                    lastTriggerMinute[lastTriggerKey] = currentMinuteOfDay;
                    global.lastScheduleTriggeredMinute = lastTriggerMinute;
                } else {
                    // console.log(`[SCHEDULER] Skipping duplicate trigger for device ${deviceId} at ${event.time}`);
                }
            }
        });
    }
}

global.lastScheduleTriggeredMinute = {};

loadAllSchedules();

cron.schedule('* * * * *', () => {
    checkSchedules();
});


// --- Integration Management API Endpoints ---
// These endpoints are for managing the connection details for external integrations like Growatt.

// Get all integrations for the logged-in user
app.get('/espcontrol/api/integrations', isAuthenticated, (req, res) => {
    const userId = req.session.userId;
    db.all(`SELECT id, integration_type, name, settings_json FROM integrations WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) {
            console.error('[INTEGRATIONS] Error fetching integrations:', err.message);
            return res.status(500).send('Failed to fetch integrations.');
        }
        // Parse settings_json back into objects before sending
        const integrations = rows.map(row => ({
            id: row.id,
            integration_type: row.integration_type,
            name: row.name,
            // SECURITY NOTE: Do NOT send sensitive info like passwords to the client
            // Filter settings if necessary before sending to client, e.g., only send username, server, but not password
            settings: JSON.parse(row.settings_json)
        }));
        res.json(integrations);
    });
});

// Add a new integration for the logged-in user
app.post('/espcontrol/api/integrations', isAuthenticated, express.json(), (req, res) => {
    const userId = req.session.userId;
    const { integration_type, name, settings } = req.body;

    if (!integration_type || !name || !settings) {
        return res.status(400).send('Missing integration_type, name, or settings.');
    }

    const settingsJsonString = JSON.stringify(settings); // Convert settings object to JSON string

    db.run(`INSERT INTO integrations (user_id, integration_type, name, settings_json) VALUES (?, ?, ?, ?)`,
        [userId, integration_type, name, settingsJsonString],
        function(err) {
            if (err) {
                console.error('[INTEGRATIONS] Error adding integration:', err.message);
                // Check for unique constraint violation
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).send('An integration with this name already exists for your user.');
                }
                return res.status(500).send('Failed to add integration.');
            }
            res.status(201).json({ id: this.lastID, message: 'Integration added successfully!' });
        }
    );
});

// ✅ NEW: Endpoint to get data from Growatt using stored credentials
app.get('/espcontrol/api/integrations/growatt/:integrationId/data', isAuthenticated, async (req, res) => {
    const integrationId = req.params.integrationId;
    const userId = req.session.userId;

    try {
        // Retrieve Growatt integration settings from the database
        db.get(`SELECT settings_json FROM integrations WHERE id = ? AND user_id = ? AND integration_type = 'Growatt'`,
            [integrationId, userId],
            async (err, row) => {
                if (err) {
                    console.error('[GROWATT] Error fetching Growatt integration settings:', err.message);
                    return res.status(500).send('Failed to retrieve integration settings.');
                }
                if (!row) {
                    return res.status(404).send('Growatt integration not found or not authorized.');
                }

                const settings = JSON.parse(row.settings_json);
                const growatt = new GrowattIntegration(settings); // Instantiate Growatt client

                try {
                    const data = await growatt.getRealtimeData(); // Fetch data from Growatt
                    res.json(data);
                } catch (growattErr) {
                    console.error('[GROWATT] Error fetching data from Growatt:', growattErr.message);
                    res.status(500).send(`Failed to fetch data from Growatt: ${growattErr.message}`);
                }
            }
        );
    } catch (generalErr) {
        console.error('[GROWATT] General error in Growatt data endpoint:', generalErr.message);
        res.status(500).send('An unexpected error occurred.');
    }
});


// Start the server
server.listen(port, () => {
    console.log(`[STARTED] ESP Control Server running at http://localhost:${port}`);
    console.log(`[SCHEDULER] Cron job scheduled to check schedules every minute.`);
});