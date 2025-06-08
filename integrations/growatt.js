// integrations/growatt.js
const Growatt = require('growatt'); // Import the growatt npm module

const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes cache timeout (adjust as needed)

/**
 * Growatt API client module.
 * Handles communication with the Growatt server and data caching.
 */
class GrowattIntegration {
    constructor(settings) {
        // Growatt credentials and server URL from settings_json
        this.username = settings.username;
        this.password = settings.password;
        this.server = settings.server || 'https://server-us.growatt.com/'; // Default server if not provided

        // Initialize the Growatt client instance
        this.growattClient = new Growatt({}); // The growatt module instance

        this.isLoggedIn = false;
        this.loginPromise = null; // To prevent multiple simultaneous login attempts

        // Specific plant and device IDs for this integration instance
        // These should be configured by the user and saved in settings_json
        // Example: { plantId: "4466", devices: ["UKDFBHG0GX", "XSK0CKS058"] }
        this.plantId = settings.plantId;
        this.deviceSerialNumbers = settings.deviceSerialNumbers || []; // Array of serial numbers for devices

        // Caching for this specific Growatt integration instance
        this.growattCache = {
            data: null,
            timestamp: 0
        };

        console.log(`[GrowattIntegration] Initialized for user ${this.username} (Plant ID: ${this.plantId})`);
    }

    /**
     * Authenticates with the Growatt server.
     * Uses a promise to ensure only one login attempt is active at a time.
     */
    async loginGrowatt() {
        if (this.isLoggedIn) {
            return;
        }
        if (this.loginPromise) {
            return this.loginPromise; // Return existing login promise if already in progress
        }

        this.loginPromise = new Promise(async (resolve, reject) => {
            try {
                // The growatt module might need the server URL to be passed
                await this.growattClient.login(this.username, this.password, this.server);
                this.isLoggedIn = true;
                console.log(`[GrowattIntegration] Successfully logged in as ${this.username} to ${this.server}`);
                this.loginPromise = null; // Clear the promise on success
                resolve();
            } catch (error) {
                console.error(`[GrowattIntegration] Login failed for ${this.username}:`, error.message);
                this.isLoggedIn = false;
                this.loginPromise = null; // Clear the promise on failure
                reject(new Error('Growatt login failed'));
            }
        });
        return this.loginPromise;
    }

    /**
     * Logs out from the Growatt server.
     */
    async logoutGrowatt() {
        if (!this.isLoggedIn) return;
        try {
            await this.growattClient.logout();
            this.isLoggedIn = false;
            console.log(`[GrowattIntegration] Successfully logged out for ${this.username}`);
        } catch (error) {
            console.error(`[GrowattIntegration] Error during logout for ${this.username}:`, error.message);
        }
    }

    /**
     * Fetches and caches Growatt data for the configured plant and devices.
     * @returns {Promise<object>} A promise that resolves with the processed Growatt data.
     */
    async getGrowattData() {
        const currentTime = Date.now();

        // Check if cached data is valid for this instance
        if (this.growattCache.data && (currentTime - this.growattCache.timestamp) < CACHE_TIMEOUT) {
            console.log(`[GrowattIntegration] Serving cached data for ${this.username}.`);
            return this.growattCache.data;
        }

        try {
            await this.loginGrowatt();

            // Fetch all plant data. The growatt module's getAllPlantData might only need user/password or session
            // The argument passed to getAllPlantData might be for filtering, or empty if it gets all for the logged-in user.
            // You might need to consult the 'growatt' npm module's documentation for exact usage.
            let getAllPlantData = await this.growattClient.getAllPlantData({});
            // console.log("Raw Growatt Data:", JSON.stringify(getAllPlantData, null, 2)); // Debug raw data structure

            const newGrowattData = {
                timestamp: currentTime,
                plantData: {},
                deviceData: {},
                weatherData: {}
            };

            // Extract data for the specific plant and devices configured for this integration
            if (this.plantId && getAllPlantData[this.plantId]) {
                const plant = getAllPlantData[this.plantId];
                newGrowattData.plantData = {
                    totalData: plant.totalData,
                    statusData: plant.statusData // If plant has overall status data
                };
                if (plant.weather && plant.weather.data && plant.weather.data.HeWeather6 && plant.weather.data.HeWeather6.length > 0) {
                     newGrowattData.weatherData = plant.weather.data.HeWeather6[0];
                }

                if (plant.devices) {
                    this.deviceSerialNumbers.forEach(serial => {
                        if (plant.devices[serial]) {
                            newGrowattData.deviceData[serial] = {
                                statusData: plant.devices[serial].statusData,
                                totalData: plant.devices[serial].totalData
                            };
                        } else {
                            console.warn(`[GrowattIntegration] Device with serial ${serial} not found in plant ${this.plantId}.`);
                        }
                    });
                }
            } else {
                console.warn(`[GrowattIntegration] Plant ID ${this.plantId} not found in Growatt data or not configured for this integration.`);
            }

            // Update cache with new data and timestamp
            this.growattCache.data = newGrowattData;
            this.growattCache.timestamp = currentTime;

            return newGrowattData;
        } catch (e) {
            console.error(`[GrowattIntegration] Error fetching Growatt data for ${this.username}:`, e);
            this.isLoggedIn = false; // Force re-login on next attempt
            throw e;
        } finally {
            // Consider logging out after fetching if you want to avoid persistent sessions,
            // but the `growatt` module might manage connections internally.
            // For now, we'll let the connection persist until the session expires or error.
            // await this.logoutGrowatt(); // Uncomment if you want to log out immediately after each fetch
        }
    }
}

module.exports = GrowattIntegration;