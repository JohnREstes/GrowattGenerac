// integrations/growatt.js
const Growatt = require('growatt');

class GrowattIntegration {
    constructor(db, integrationId, settings) {
        this.db = db;
        this.integrationId = integrationId;
        this.settings = settings;

        this.growatt = new Growatt({});
        this.isLoggedIn = false;
        this.lastLoginTime = 0;
        this.loginTimeout = 24 * 60 * 60 * 1000; // ⏰ 24 hours in milliseconds

        this.settings.plantId = this.settings.plantId || null;
        this.settings.deviceSerialNumbers = this.settings.deviceSerialNumbers || [];
    }

    async login(force = false) {
        if (!this.settings.username || !this.settings.password || !this.settings.server) {
            throw new Error('Growatt username, password, or server URL not configured.');
        }

        const currentTime = Date.now();

        if (!force && this.isLoggedIn && (currentTime - this.lastLoginTime < this.loginTimeout)) {
            // 🟢 Already logged in and session still valid
            return;
        }

        try {
            console.log(`[GrowattIntegration-${this.integrationId}] Attempting login to Growatt server: ${this.settings.server}`);
            await this.growatt.login(this.settings.username, this.settings.password, this.settings.server);
            this.isLoggedIn = true;
            this.lastLoginTime = currentTime;
            console.log(`[GrowattIntegration-${this.integrationId}] Growatt login successful.`);
        } catch (error) {
            // Only reset login if Growatt explicitly rejects session
            if (error.message.includes('unauthorized') || error.message.includes('login')) {
                this.isLoggedIn = false;
            }

            console.error(`[GrowattIntegration-${this.integrationId}] Error fetching data:`, error);
            throw new Error(`Failed to fetch data from Growatt: ${error.message}`);
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
        }
    }

    async fetchData() {
        await this.login(); // Reuse cached session if valid

        try {
            const allPlantData = await this.growatt.getAllPlantData({});
            console.log(`[GrowattIntegration-${this.integrationId}] Successfully fetched all plant data from Growatt.`);

            const relevantData = { allRawPlantData: allPlantData };
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

            relevantData.inverters = inverterSummaries;

            if (this.settings.plantId && allPlantData[this.settings.plantId]) {
                const targetPlant = allPlantData[this.settings.plantId];
                relevantData.plantData = targetPlant;

                if (this.settings.deviceSerialNumbers?.length) {
                    const filteredDevices = {};
                    for (const serial of this.settings.deviceSerialNumbers) {
                        if (targetPlant.devices?.[serial]) {
                            filteredDevices[serial] = targetPlant.devices[serial];
                        } else {
                            console.warn(`[GrowattIntegration-${this.integrationId}] Configured serial ${serial} not found for plant ${this.settings.plantId}.`);
                        }
                    }
                    relevantData.plantData.devices = filteredDevices;
                }
            } else if (this.settings.plantId) {
                console.warn(`[GrowattIntegration-${this.integrationId}] Configured Plant ID ${this.settings.plantId} not found.`);
            }

            return relevantData;
        } catch (error) {
            this.isLoggedIn = false;
            console.error(`[GrowattIntegration-${this.integrationId}] Error fetching data:`, error);
            throw new Error(`Failed to fetch data from Growatt: ${error.message}`);
        }
    }
}

module.exports = GrowattIntegration;
