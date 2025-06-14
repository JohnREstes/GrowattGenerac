const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const Growatt = require('growatt');

const app = express();
const PORT = 3001;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let growattClient = null;
let isLoggedIn = false;
let storedCredentials = { username: null, password: null };

async function loginGrowatt() {
  if (!storedCredentials.username || !storedCredentials.password) {
    throw new Error('Stored credentials missing');
  }

  growattClient = new Growatt({});
  await growattClient.login(storedCredentials.username, storedCredentials.password);
  isLoggedIn = true;
  console.log(`[GROWATT] Re-login successful for user: ${storedCredentials.username}`);
}

app.post('/api/growatt/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    growattClient = new Growatt({});
    await growattClient.login(username, password);
    storedCredentials = { username, password };
    isLoggedIn = true;

    console.log(`[GROWATT] Login successful for user: ${username}`);
    res.json({ success: true, message: 'Login successful' });
  } catch (err) {
    console.error('[GROWATT] Login failed:', err.message);
    res.status(500).json({ success: false, error: 'Login failed', details: err.message });
  }
});

app.get('/api/growatt/data', async (req, res) => {
  try {
    if (!growattClient || !isLoggedIn) {
      throw new Error('Session not initialized');
    }

    let plantData;
    try {
      plantData = await growattClient.getAllPlantData({});
    } catch (err) {
      console.warn('[GROWATT] First data fetch failed, trying re-login:', err.message);
      isLoggedIn = false;
      await loginGrowatt(); // Try re-login
      plantData = await growattClient.getAllPlantData({}); // Retry
    }

    const inverterSummaries = [];

    for (const pid in plantData) {
      const plant = plantData[pid];
      const devices = plant.devices || {};

      for (const deviceId in devices) {
        const status = devices[deviceId]?.statusData || {};

        inverterSummaries.push({
          plantName: plant.plantName,
          inverterId: deviceId,
          batteryVoltage: status.vBat || 'N/A',
          batteryPercentage: status.capacity || 'N/A',
          acInputPower: status.gridPower || 'N/A',
          acOutputPower: status.loadPower || 'N/A',
          solarPanelPower: status.panelPower || 'N/A',
        });
      }
    }

    res.json({
      success: true,
      message: 'Battery data fetched successfully',
      inverters: inverterSummaries
    });

  } catch (err) {
    console.error('[GROWATT] Final data fetch failed:', err.message);
    res.status(500).json({ success: false, error: 'Data fetch failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Growatt Test Server running at http://localhost:${PORT}`);
});
