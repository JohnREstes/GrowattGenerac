// growattScraper.js
const { chromium } = require('playwright-chromium');

/**
 * Scrapes Growatt inverter data from the web portal.
 * @param {string} username - Growatt username/email
 * @param {string} password - Growatt password
 * @param {string} inverterSerial - The serial number of the SPH inverter to target (used for navigation)
 */
async function scrapeGrowattData(username, password, inverterSerial) {
    let browser;
    try {
        // Launch a headless browser instance
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        console.log("Starting Growatt login via Playwright...");
        await page.goto('https://server.growatt.com/');

        // --- Login Process ---
        await page.fill('#val_loginAccount', username);
        await page.fill('#val_loginPwd', password);
        await page.click('button.loginB');
        
        // Wait for navigation to the dashboard after successful login
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        console.log("Login successful. Navigating dashboard.");

        // --- Data Scraping ---
        
        const tipsElementSelector = '.tips.w';
        let inverterMetrics = {};

        try {
            // Wait for the tips element to be attached to the DOM
            await page.waitForSelector(tipsElementSelector, { state: 'attached', timeout: 30000 });
            
            // Hover over the tips icon/area to reveal the data table
            await page.hover(tipsElementSelector);
            
            // Wait for the .val_vBat element to have valid content after the hover action.
            await page.waitForFunction(() => {
                const element = document.querySelector('.val_vBat');
                if (element && element.textContent) {
                    const text = element.textContent.trim();
                    // Check if the text is present and not just a hyphen
                    return text.length > 0 && text !== '-'; 
                }
                return false;
            }, { timeout: 30000 });

            inverterMetrics = await page.evaluate(() => {
                // Helper function to get text content from a selector and parse as a numerical value
                const getText = (selector) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        const text = element.textContent.trim();
                        const match = text.match(/([\d.]+)/);
                        return match ? parseFloat(match[1]) : text;
                    }
                    return null;
                };

                const getSystemStatus = (selector) => {
                    const element = document.querySelector(selector);
                    return element ? element.textContent.trim() : null;
                };

                // Selectors for the inverter data on the dashboard page:
                return {
                    systemStatus: getSystemStatus('.valc + .val'), 
                    batteryVoltage: getText('.val_vBat'), 
                    pvPower1: getText('.val_pPv1'),
                    pvPower2: getText('.val_pPv2'),
                    pvPower3: getText('.val_pPv3'),
                    consumption: getText('.abs span.val:nth-of-type(2)') 
                };
            });
            
        } catch (error) {
            console.error(`Playwright scraping failed during hover or evaluation for device ${inverterSerial}:`, error.message);
            // Return an object indicating failure if the scraping process failed
            inverterMetrics = {
                error: `Playwright scraping failed: ${error.message}`
            };
        }

        console.log("Scraped data:", inverterMetrics);
        return inverterMetrics;

    } catch (error) {
        console.error("Playwright scraping failed:", error);
        // Rethrow if the failure is during the login or browser setup
        throw error;
    } finally {
        // Ensure the browser closes
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = { scrapeGrowattData };