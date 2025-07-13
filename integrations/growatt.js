// integrations/growatt.js

const Growatt = require('growatt');
const growattInstances = {}; 

// Import the Playwright scraper developed previously
const { scrapeGrowattData } = require('./growattScraper');

// Define SPH type identifier (assuming 'SPH' from Growatt API responses)
const SPH_INVERTER_TYPE = 'SPH'; 

// Define specific serial numbers that should always use the NPM module, regardless of incomplete data
const NPM_ONLY_DEVICES = ['UKDFBHG0GX', 'XSK0CKS058', 'XSK0CKS03A'];

class GrowattIntegration {
    constructor(db, integrationId, settings) {
        this.db = db;
        this.integrationId = integrationId;
        this.settings = settings;

        // Initialize Growatt API client with the server specified in settings, or default
        this.growatt = new Growatt({
            server: this.settings.server || 'https://server.growatt.com'
        });
        this.isLoggedIn = false;
        this.lastLoginTime = 0;
        this.loginTimeout = 24 * 60 * 60 * 1000;

        // Ensure settings have default properties
        this.settings.plantId = this.settings.plantId || null;
        this.settings.deviceSerialNumbers = this.settings.deviceSerialNumbers || [];

        this.lastFetchedData = null;
    }

    static getInstance(db, integrationId, settings) {
        if (!growattInstances[integrationId]) {
            growattInstances[integrationId] = new GrowattIntegration(db, integrationId, settings);
        } else {
            growattInstances[integrationId].settings = settings;
        }
        return growattInstances[integrationId];
    }

    async login(force = false) {
        const currentTime = Date.now();

        if (!force && this.isLoggedIn && (currentTime - this.lastLoginTime < this.loginTimeout)) {
            return;
        }

        try {
            console.log(`[GrowattIntegration-${this.integrationId}] Attempting login to Growatt server: ${this.settings.server}`);
            // Use the Growatt NPM library login
            await this.growatt.login(this.settings.username, this.settings.password);
            this.isLoggedIn = true;
            this.lastLoginTime = currentTime;
            console.log(`[GrowattIntegration-${this.integrationId}] Growatt login successful.`);
        } catch (error) {
            if (error.message.includes('unauthorized') || error.message.includes('login')) {
                this.isLoggedIn = false;
            }
            console.error(`[GrowattIntegration-${this.integrationId}] Error during login:`, error);
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
        }
    }

    async fetchData() {
        await this.login();

        try {
            // Step 1: Use Growatt NPM to fetch all plant data initially
            const allPlantData = await this.growatt.getAllPlantData({});
            console.log(`[GrowattIntegration-${this.integrationId}] Successfully fetched all plant data from Growatt.`);
            
            const relevantData = { allRawPlantData: allPlantData };
            const inverterSummaries = [];

            for (const pid in allPlantData) {
                const plant = allPlantData[pid];
                const devices = plant.devices || {};

                for (const deviceId in devices) {
                    const device = devices[deviceId];
                    
                    // Check if the device is specifically marked as an NPM-only device
                    const isNPMOnly = NPM_ONLY_DEVICES.includes(deviceId);

                    // Check if the device is an SPH inverter based on deviceType
                    const isSPHInverter = device.deviceType && device.deviceType.toUpperCase().includes(SPH_INVERTER_TYPE);
                    
                    // Check if the NPM data is incomplete (used for fallback scraping if not an NPM-only device)
                    const isNPMDataIncomplete = !device.deviceType || !device.statusData || !device.statusData.status; 
                    
                    let deviceData = {};

                    // Use Playwright if it's an SPH inverter OR if data is incomplete AND it's NOT an NPM-only device.
                    const usePlaywright = isSPHInverter || (!isNPMOnly && isNPMDataIncomplete);

                    if (usePlaywright) {
                        console.log(`[GrowattIntegration-${this.integrationId}] Using Playwright scraper for (${deviceId}). Reason: SPH detected or NPM data incomplete.`);
                        try {
                            // Step 2a: Use Playwright scraper for detailed metrics
                            deviceData = await scrapeGrowattData(this.settings.username, this.settings.password, deviceId);
                            deviceData.inverterType = device.deviceType; // Preserve the type if we got it
                        } catch (scrapeError) {
                            console.error(`[GrowattIntegration-${this.integrationId}] Playwright scraping failed for ${deviceId}:`, scrapeError.message);
                            // Fallback to NPM data if available
                            deviceData = device?.statusData || {}; 
                            deviceData.inverterType = device.deviceType;
                        }
                    } else {
                        console.log(`[GrowattIntegration-${this.integrationId}] Using Growatt NPM data for device (${deviceId}).`);
                        // Step 2b: Use existing data from the NPM package for NPM-only or complete data devices
                        deviceData = {
                            systemStatus: device?.statusData?.status || 'N/A', 
                            batteryVoltage: device?.statusData?.vBat || 'N/A',
                            batteryPower: (-1 * (device?.statusData?.batPower || 0)) || 'N/A',
                            batteryPercentage: device?.statusData?.capacity || 'N/A',
                            acInputPower: device?.statusData?.gridPower || 'N/A',
                            acOutputPower: device?.statusData?.loadPower || 'N/A',
                            solarPanelPower: device?.statusData?.panelPower || 'N/A',
                            inverterType: device.deviceType,
                        };
                    }

                    // Push the combined/selected data into the inverterSummaries array
                    inverterSummaries.push({
                        plantName: plant.plantName,
                        inverterId: deviceId,
                        ...deviceData
                    });
                }
            }

            relevantData.inverters = inverterSummaries;

            // Filter plant data based on settings (optional based on your setup)
            if (this.settings.plantId && allPlantData[this.settings.plantId]) {
                const targetPlant = allPlantData[this.settings.plantId];
                relevantData.plantData = targetPlant;

                if (this.settings.deviceSerialNumbers?.length) {
                    const filteredDevices = {};
                    for (const serial of this.settings.deviceSerialNumbers) {
                        if (targetPlant.devices?.[serial]) {
                            filteredDevices[serial] = targetPlant.devices[serial];
                        } else {
                            console.warn(`[GrowattIntegration-${this.integrationId}] Serial ${serial} not found.`);
                        }
                    }
                    relevantData.plantData.devices = filteredDevices;
                }
            }

            this.lastFetchedData = {
                timestamp: Date.now(), 
                data: relevantData
            };
            console.log(`[GrowattIntegration-${this.integrationId}] Data fetched and cached.`);
            
            return relevantData;

        } catch (error) {
            this.isLoggedIn = false;
            console.error(`[GrowattIntegration-${this.integrationId}] Error fetching data:`, error);
            throw new Error(`Failed to fetch data from Growatt: ${error.message}`);
        }
    }
}

module.exports = GrowattIntegration;