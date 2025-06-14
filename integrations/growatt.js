// integrations/growatt.js
const Growatt = require('growatt');

class GrowattIntegration {
    constructor(db, integrationId, settings) {
        this.db = db;
        this.integrationId = integrationId;
        this.settings = settings; // settings_json parsed into an object
        
        // Initialize Growatt API client with user credentials
        this.growatt = new Growatt({}); // Initialize with empty object, login handled separately
        this.isLoggedIn = false;
        this.lastLoginAttempt = 0;
        this.loginTimeout = 5 * 60 * 1000; // 5 minutes in milliseconds for login timeout

        // Ensure settings have default properties if not present
        this.settings.plantId = this.settings.plantId || null;
        this.settings.deviceSerialNumbers = this.settings.deviceSerialNumbers || [];
    }

    async login() {
        if (!this.settings.username || !this.settings.password || !this.settings.server) {
            throw new Error('Growatt username, password, or server URL not configured.');
        }

        const currentTime = Date.now();
        // Prevent frequent login attempts if a recent one failed or is in progress
        if (this.isLoggedIn && (currentTime - this.lastLoginAttempt < this.loginTimeout)) {
            // Already logged in or recently attempted.
            return;
        }

        try {
            console.log(`[GrowattIntegration-${this.integrationId}] Attempting login to Growatt server: ${this.settings.server}`);
            await this.growatt.login(this.settings.username, this.settings.password, this.settings.server);
            this.isLoggedIn = true;
            this.lastLoginAttempt = currentTime; // Record successful login time
            console.log(`[GrowattIntegration-${this.integrationId}] Growatt login successful.`);
        } catch (error) {
            console.error(`[GrowattIntegration-${this.integrationId}] Growatt login failed:`, error.message);
            this.isLoggedIn = false; // Mark as not logged in on failure
            this.lastLoginAttempt = currentTime; // Record failed login attempt time to respect timeout
            throw new Error(`Failed to log in to Growatt: ${error.message}`);
        }
    }

    async logout() {
        if (!this.isLoggedIn) return;
        try {
            await this.growatt.logout();
            this.isLoggedIn = false;
            console.log(`[GrowattIntegration-${this.integrationId}] Growatt logout complete.`);
        } catch (error) {
            console.error(`[GrowattIntegration-${this.integrationId}] Growatt logout failed:`, error.message);
            // Don't rethrow, as logout failure shouldn't stop other processes
        }
    }

    // This method will fetch data from Growatt based on the integration's settings
    async fetchData() {
        await this.login(); // Ensure logged in before fetching data

        try {
            // Get ALL plant data accessible by the logged-in user
            const allPlantData = await this.growatt.getAllPlantData({});
            console.log(`[GrowattIntegration-${this.integrationId}] Successfully fetched all plant data from Growatt.`);

            let relevantData = {};
            // Include raw allPlantData for full discovery
            relevantData.allRawPlantData = allPlantData;

            // --- NEW LOGIC: Process all inverters for summary ---
            const inverterSummaries = [];
            for (const pid in allPlantData) {
                const plant = allPlantData[pid];
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
            relevantData.inverters = inverterSummaries; // Add the new structured summaries
            // --- END NEW LOGIC ---

            // Existing logic: If a specific plantId is configured, still provide its data under 'plantData'
            if (this.settings.plantId && allPlantData[this.settings.plantId]) {
                const targetPlant = allPlantData[this.settings.plantId];
                relevantData.plantData = targetPlant; // Data for the specifically configured plant

                // Original filtering for deviceSerialNumbers can remain if you want to subset
                // relevantData.plantData.devices for a *specific* plant's devices.
                // However, the `inverters` array already gives you all devices across all plants.
                if (this.settings.deviceSerialNumbers && this.settings.deviceSerialNumbers.length > 0) {
                    const filteredDevices = {};
                    for (const serial of this.settings.deviceSerialNumbers) {
                        if (targetPlant.devices && targetPlant.devices[serial]) {
                            filteredDevices[serial] = targetPlant.devices[serial];
                        } else {
                            console.warn(`[GrowattIntegration-${this.integrationId}] Configured device serial ${serial} not found for plant ${this.settings.plantId}.`);
                        }
                    }
                    relevantData.plantData.devices = filteredDevices;
                }
            } else if (this.settings.plantId) {
                console.warn(`[GrowattIntegration-${this.integrationId}] Configured Plant ID ${this.settings.plantId} not found in Growatt account.`);
            }

            return relevantData; // Return all data, including the new `inverters` summary
        } catch (error) {
            console.error(`[GrowattIntegration-${this.integrationId}] Error fetching data from Growatt:`, error);
            this.isLoggedIn = false;
            throw new Error(`Failed to fetch data from Growatt: ${error.message}`);
        }
    }
}

module.exports = GrowattIntegration;