// index.js

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
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

const fs = require('fs');

const port = 3020;

const SESSION_SECRET = process.env.SESSION_SECRET;

const deviceStates = {};
const loadedSchedules = {};
const deviceTimezones = {};

// Unauthenticated control check for ESP8266
app.get('/espcontrol/device', (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID is required' });
    }

    const state = deviceStates[deviceId] || 'OFF';
    res.json({ deviceId, state });
});

// ✅ NEW: Import the Growatt Integration module
const GrowattIntegration = require('./integrations/growatt');

// Secret key for JWTs (use a strong, environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key'; // Make sure this is defined

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
        return res.sendStatus(401); // No token
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.warn('[AUTH] JWT verification failed:', err.message);
            return res.sendStatus(403); // Token no longer valid or expired
        }
        req.user = user;
        next();
    });
}

// Session middleware
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use('/espcontrol', express.static(path.join(__dirname, 'public')));

// Public route for login
app.post('/espcontrol/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error('[DB] Login error:', err.message);
            return res.status(500).send('Database error');
        }
        if (!user) {
            return res.status(400).send('Invalid username or password');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).send('Invalid username or password');
        }

        // Generate JWT token
        const accessToken = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        
        req.session.userId = user.id; // Store user ID in session
        req.session.isAuthenticated = true; // Set authentication status

        res.json({ message: 'Login successful', token: accessToken });
    });
});

// Middleware to check if user is authenticated via session (for direct HTML access)
function checkAuthentication(req, res, next) {
    if (req.session.isAuthenticated) {
        next();
    } else {
        res.redirect('/espcontrol/login.html');
    }
}

// Serve the main control panel HTML after authentication
app.get('/espcontrol/', checkAuthentication, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // HTTP 1.1
    res.setHeader('Pragma', 'no-cache'); // HTTP 1.0
    res.setHeader('Expires', '0'); // Proxies

    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Logout route
app.get('/espcontrol/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/espcontrol/login.html');
    });
});

// Device management API endpoints
app.get('/espcontrol/api/devices', authenticateToken, (req, res) => {
    const userId = req.user.id;
    db.all(
    'SELECT id, settings_json FROM integrations WHERE integration_type = ? AND (is_active IS NULL OR is_active = 0)',
    ['Growatt'],
    async (err, rows) => {
        if (err) {
            console.error('[DB] Error fetching devices:', err.message);
            return res.status(500).json({ error: 'Database error fetching devices' });
        }
        res.json(rows);
    });
});

// GPIO control endpoint
app.get('/espcontrol/control', authenticateToken, (req, res) => {
    const deviceId = req.query.deviceId;
    if (!deviceId) {
        return res.status(400).send('Device ID is required');
    }
    const userId = req.user.id;

    db.get('SELECT device_name FROM devices WHERE id = ? AND user_id = ?', [deviceId, userId], (err, device) => {
        if (err) {
            console.error('[DB] Error fetching device for control:', err.message);
            return res.status(500).json({ error: 'Database error fetching device' });
        }
        if (!device) {
            return res.status(404).json({ error: 'Device not found or not owned by user' });
        }
        const state = deviceStates[deviceId] || 'OFF';
        res.json({ deviceId: deviceId, state: state });
    });
});

app.post('/espcontrol/control', authenticateToken, (req, res) => {
    const { deviceId, state } = req.body;
    if (!deviceId || !['ON', 'OFF'].includes(state)) {
        return res.status(400).send('Device ID and valid state (ON/OFF) are required');
    }
    const userId = req.user.id;

    db.get('SELECT device_name FROM devices WHERE id = ? AND user_id = ?', [deviceId, userId], (err, device) => {
        if (err) {
            console.error('[DB] Error fetching device for control:', err.message);
            return res.status(500).json({ error: 'Database error fetching device' });
        }
        if (!device) {
            return res.status(404).json({ error: 'Device not found or not owned by user' });
        }
        deviceStates[deviceId] = state; // Update in-memory state
        console.log(`[GPIO] Device ${deviceId} set to ${state}`);
        res.json({ message: `Device ${deviceId} set to ${state}` });
    });
});


// Schedule API endpoints
app.get('/espcontrol/api/schedule/:deviceId', authenticateToken, (req, res) => {
    const deviceId = req.params.deviceId;
    const userId = req.user.id;

    db.get('SELECT * FROM schedules WHERE device_id = ? AND user_id = ?', [deviceId, userId], (err, schedule) => {
        if (err) {
            console.error('[DB] Error fetching schedule:', err.message);
            return res.status(500).json({ error: 'Database error fetching schedule' });
        }
        if (!schedule) {
            return res.json({ events: [], timezone: 'UTC' }); // Return empty if no schedule found
        }
        res.json({
            timezone: schedule.timezone,
            events: JSON.parse(schedule.events_json)
        });
    });
});

app.post('/espcontrol/api/schedule/:deviceId', authenticateToken, (req, res) => {
    const deviceId = req.params.deviceId;
    const { timezone, events } = req.body;
    const userId = req.user.id;

    if (!timezone || !Array.isArray(events)) {
        return res.status(400).json({ error: 'Timezone and events array are required.' });
    }

    const eventsJson = JSON.stringify(events);

    db.run(
        'INSERT OR REPLACE INTO schedules (device_id, user_id, timezone, events_json) VALUES (?, ?, ?, ?)',
        [deviceId, userId, timezone, eventsJson],
        function (err) {
            if (err) {
                console.error('[DB] Error saving schedule:', err.message);
                return res.status(500).json({ error: 'Database error saving schedule' });
            }
            // Clear existing cron jobs for this device
            if (loadedSchedules[deviceId]) {
                loadedSchedules[deviceId].forEach(job => job.stop());
                delete loadedSchedules[deviceId];
            }
            // Load and schedule new events
            loadAndScheduleEvents(deviceId, userId);
            res.json({ message: 'Schedule saved successfully.' });
        }
    );
});

// Function to load and schedule events from DB
function loadAndScheduleEvents(deviceId, userId) {
    db.get('SELECT * FROM schedules WHERE device_id = ? AND user_id = ?', [deviceId, userId], (err, schedule) => {
        if (err || !schedule) {
            console.error(`[CRON] Could not load schedule for device ${deviceId}:`, err ? err.message : 'No schedule found');
            return;
        }

        const events = JSON.parse(schedule.events_json);
        const timezone = schedule.timezone;
        loadedSchedules[deviceId] = [];

        events.forEach(event => {
            const [hour, minute] = event.time.split(':');
            const cronTime = `${minute} ${hour} * * *`; // Minute Hour DayOfMonth Month DayOfWeek

            const job = cron.schedule(cronTime, () => {
                const now = momentTz().tz(timezone);
                console.log(`[CRON] Executing scheduled action for device ${deviceId} at ${now.format('HH:mm z')}: ${event.action}`);
                // In a real scenario, this would send a command to the ESP8266
                deviceStates[deviceId] = event.action; // Update in-memory state
            }, {
                scheduled: true,
                timezone: timezone
            });
            loadedSchedules[deviceId].push(job);
        });
        console.log(`[CRON] Scheduled ${events.length} events for device ${deviceId} in timezone ${timezone}.`);
    });
}

// Load all schedules on server startup
db.all('SELECT device_id, user_id FROM schedules', [], (err, rows) => {
    if (err) {
        console.error('[CRON] Error loading schedules on startup:', err.message);
        return;
    }
    rows.forEach(row => {
        loadAndScheduleEvents(row.device_id, row.user_id);
        deviceStates[row.device_id] = 'OFF'; // 🛠️ default initial state
    });
});


// --- INTEGRATION API ENDPOINTS ---

// GET all integrations for a user
app.get('/espcontrol/api/integrations', authenticateToken, (req, res) => {
    const userId = req.user.id;
    db.all('SELECT id, name, integration_type, settings_json FROM integrations WHERE user_id = ?', [userId], (err, rows) => {
        if (err) {
            console.error('[DB] Error fetching integrations:', err.message);
            return res.status(500).json({ error: 'Database error fetching integrations' });
        }
        // Parse settings_json for each integration before sending
        const integrations = rows.map(row => {
            const integration = { ...row };
            if (integration.settings_json) {
                integration.settings = JSON.parse(integration.settings_json);
                delete integration.settings_json; // Remove the raw JSON string
            } else {
                integration.settings = {};
            }
            return integration;
        });
        res.json(integrations);
    });
});

// POST a new integration
app.post('/espcontrol/api/integrations', authenticateToken, (req, res) => {
    const { name, integration_type, settings } = req.body;
    const userId = req.user.id;

    if (!name || !integration_type || !settings) {
        return res.status(400).json({ error: 'Name, integration_type, and settings are required.' });
    }

    const settingsJson = JSON.stringify(settings);

    db.run(
        'INSERT INTO integrations (user_id, name, integration_type, settings_json) VALUES (?, ?, ?, ?)',
        [userId, name, integration_type, settingsJson],
        // START OF NEW CODE INSERTION
        async function(err) {
            if (err) {
                console.error('[DB] Error adding integration:', err.message);
                return res.status(500).json({ error: 'Database error adding integration' });
            }
            console.log(`[API] Integration added for user ${userId}, ID: ${this.lastID}`);

            // NEW: Immediately fetch data for the new integration if it's a Growatt integration
            if (integration_type === 'Growatt') { // Only attempt Growatt-specific fetch if type matches
                try {
                    // Use this.lastID for the newly created integration's ID
                    const growattIntegration = GrowattIntegration.getInstance(db, this.lastID, settings);
                    await growattIntegration.fetchData(); // This will populate lastFetchedData
                    console.log(`[API] Initial Growatt data fetched for new integration ${this.lastID}.`);
                    res.status(201).json({ message: 'Growatt integration added and initial data fetched successfully!', integrationId: this.lastID });
                } catch (fetchError) {
                    console.error(`[API] Error during initial Growatt data fetch for new integration ${this.lastID}:`, fetchError.message);
                    // Even if initial fetch fails, the integration itself was added.
                    res.status(201).json({ message: `Growatt integration added, but initial data fetch failed: ${fetchError.message}`, integrationId: this.lastID });
                }
            } else {
                // For non-Growatt integrations, just send the success response
                res.status(201).json({ message: 'Integration added successfully', id: this.lastID });
            }
        }
        // END OF NEW CODE INSERTION
    );
});

// DELETE an integration
app.delete('/espcontrol/api/integrations/:id', authenticateToken, (req, res) => {
    const integrationId = req.params.id;
    const userId = req.user.id;

    db.run('DELETE FROM integrations WHERE id = ? AND user_id = ?', [integrationId, userId], function (err) {
        if (err) {
            console.error('[DB] Error deleting integration:', err.message);
            return res.status(500).json({ error: 'Database error deleting integration' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Integration not found or not owned by user' });
        }
        res.json({ message: 'Integration deleted successfully' });
    });
});

// PUT (update) an integration
app.put('/espcontrol/api/integrations/:id', authenticateToken, (req, res) => {
    const integrationId = req.params.id;
    const { name, integration_type, settings } = req.body; // settings should be an object
    const userId = req.user.id;

    if (!name || !integration_type || !settings) {
        return res.status(400).json({ error: 'Name, integration_type, and settings are required.' });
    }

    const settingsJson = JSON.stringify(settings); // Convert settings object back to JSON string

    db.run(
        'UPDATE integrations SET name = ?, integration_type = ?, settings_json = ? WHERE id = ? AND user_id = ?',
        [name, integration_type, settingsJson, integrationId, userId],
        function (err) {
            if (err) {
                console.error('[DB] Error updating integration:', err.message);
                return res.status(500).json({ error: 'Database error updating integration' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Integration not found or not owned by user' });
            }
            res.json({ message: 'Integration updated successfully' });
        }
    );
});


app.get('/espcontrol/api/growatt/data/:integrationId', authenticateToken, (req, res) => {
    const integrationId = req.params.integrationId;
    const userId = req.user.id;
    // Set a threshold for how "fresh" the cached data needs to be for a client-requested pull
    // If client pulls every 30s, this should be slightly less to ensure a fresh fetch.
    const CLIENT_CACHE_FRESHNESS_THRESHOLD_MS = 25 * 1000; // 25 seconds

    // First, verify the integration belongs to the user
    db.get('SELECT settings_json FROM integrations WHERE id = ? AND user_id = ? AND integration_type = ?',
        [integrationId, userId, 'Growatt'],
        async (err, row) => {
            if (err) {
                console.error('[DB] Error fetching Growatt integration settings:', err.message);
                return res.status(500).json({ error: 'Database error fetching integration settings' });
            }
            if (!row || !row.settings_json) {
                return res.status(404).json({ error: 'Growatt integration not found or settings are missing.' });
            }

            try {
                const settings = JSON.parse(row.settings_json);
                const growattIntegration = GrowattIntegration.getInstance(db, integrationId, settings);

                const currentTime = Date.now();
                // Check if cached data is available AND sufficiently fresh for a logged-in user's request
                if (growattIntegration.lastFetchedData &&
                    (currentTime - growattIntegration.lastFetchedData.timestamp < CLIENT_CACHE_FRESHNESS_THRESHOLD_MS)) {
                    console.log(`[API] Serving fresh cached Growatt data for integration ${integrationId}, fetched at ${new Date(growattIntegration.lastFetchedData.timestamp).toLocaleTimeString()}`);
                    res.json(growattIntegration.lastFetchedData.data);
                } else {
                    // Cache is old, non-existent, or it's time for a refresh for this client request.
                    console.log(`[API] Cached Growatt data for integration ${integrationId} is stale or missing, performing immediate fetch.`);
                    const data = await growattIntegration.fetchData(); // This will refresh the instance's cache too
                    res.json(data);
                }
            } catch (error) {
                console.error(`[API] Error retrieving Growatt data for integration ${integrationId}:`, error.message);
                res.status(500).json({ error: 'Failed to retrieve Growatt data', details: error.message });
            }
        }
    );
});


async function refreshAllGrowattIntegrations() {
    console.log('[CRON] Starting scheduled Growatt data refresh for all integrations...');
    db.all('SELECT id, settings_json FROM integrations WHERE integration_type = ?', ['Growatt'], async (err, rows) => {
        if (err) {
            console.error('[CRON] Error fetching Growatt integrations for refresh:', err.message);
            return;
        }

        for (const row of rows) {
            try {
                const settings = JSON.parse(row.settings_json);
                const growattIntegration = GrowattIntegration.getInstance(db, row.id, settings);
                await growattIntegration.fetchData(); // This will update the cached data within the instance
                console.log(`[CRON] Successfully refreshed data for Growatt integration ID: ${row.id}`);
            } catch (error) {
                console.error(`[CRON] Failed to refresh data for Growatt integration ID: ${row.id}:`, error.message);
            }
        }
        console.log('[CRON] Finished scheduled Growatt data refresh.');
    });
}

app.post('/espcontrol/api/integrations/:id/active', authenticateToken, (req, res) => {
    const integrationId = req.params.id;
    const userId = req.user.id;
    const isActive = req.body.isActive ? 1 : 0;

    db.run(
        'UPDATE integrations SET is_active = ? WHERE id = ? AND user_id = ?',
        [isActive, integrationId, userId],
        function (err) {
            if (err) {
                console.error('[DB] Error updating integration active status:', err.message);
                return res.status(500).json({ error: 'Database error updating integration activity' });
            }
            res.json({ message: `Integration ${integrationId} activity updated to ${isActive}` });
        }
    );
});

// Start the server
server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/espcontrol/`);
    console.log('Ensure your ESP8266 devices are configured to connect to this server.');
    refreshAllGrowattIntegrations();
});

// NEW: Schedule Growatt data refresh every 5 minutes (300 seconds)
// This will run at minute 0, 5, 10, etc.
cron.schedule('*/5 * * * *', () => {
    refreshAllGrowattIntegrations();
});