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
        
        // Hover over the tips element to reveal the data in the associated table
        await page.hover('.tips.w');
        
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


        const inverterMetrics = await page.evaluate(() => {
            
            // Helper function to extract text content from an element and parse as a numerical value
            const extractValueFromElement = (element) => {
                if (element) {
                    const text = element.textContent.trim();
                    // Regex to extract numbers (including decimals) from the text
                    const match = text.match(/([\d.]+)/);
                    return match ? parseFloat(match[1]) : text;
                }
                return null;
            };

            // Helper function to find an element by selector and extract its value
            const getValueBySelector = (selector) => {
                const element = document.querySelector(selector);
                return extractValueFromElement(element);
            };

            // Helper function to find a value based on a text label within the provided HTML structure
            const getValueByLabel = (label) => {
                // Find the div.abs containing the specific label text in span.text, then get the value from span.val
                const element = Array.from(document.querySelectorAll('div.abs')).find(
                    div => {
                        const textSpan = div.querySelector('span.text');
                        // Check if the div contains a span.text with the specific label
                        return textSpan && textSpan.textContent.includes(label);
                    }
                );
                
                if (element) {
                    const valueSpan = element.querySelector('span.val');
                    // Use extractValueFromElement on the found span element
                    return extractValueFromElement(valueSpan);
                }
                return null;
            };

            const getSystemStatus = (selector) => {
                const element = document.querySelector(selector);
                return element ? element.textContent.trim() : null;
            };

            // Selectors for the inverter data on the dashboard page:
            const metrics = {
                // Using getValueBySelector for metrics retrieved via direct CSS selectors
                systemStatus: getSystemStatus('.valc + .val'), 
                batteryVoltage: getValueBySelector('.val_vBat'), 
                pvPower1: getValueBySelector('.val_pPv1'),
                pvPower2: getValueBySelector('.val_pPv2'),
                pvPower3: getValueBySelector('.val_pPv3'),
                
                // Using the new getValueByLabel helper for Consumption and Generator Rated Power:
                acOutputPower: getValueByLabel('Consumption'),
                acInputPower: getValueByLabel('Generator Rated Power'),
                
                // Keeping previous selectors for other metrics that might be found via standard classes
                batteryPower: getValueBySelector('.val_batP'),
                batteryPercentage: getValueBySelector('.val_batCap'),
            };

            // Calculate solarPanelPower (sum of PV inputs)
            metrics.solarPanelPower = (metrics.pvPower1 || 0) + (metrics.pvPower2 || 0) + (metrics.pvPower3 || 0);

            // Note: The previous 'consumption' field seems redundant if acOutputPower is 'Consumption', 
            // but we'll include it using getValueByLabel for consistency.
            metrics.consumption = getValueByLabel('Consumption'); 

            return metrics;
        });

        console.log("Scraped data:", inverterMetrics);
        return inverterMetrics;

    } catch (error) {
        // If scraping fails (e.g., hover timeout), return a structured response with N/A
        console.error("Playwright scraping failed:", error);
        return {
            systemStatus: 'N/A',
            batteryVoltage: 'N/A',
            batteryPower: 'N/A',
            batteryPercentage: 'N/A',
            acInputPower: 'N/A',
            acOutputPower: 'N/A',
            solarPanelPower: 'N/A',
            error: error.message
        };
    } finally {
        // Ensure the browser closes
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = { scrapeGrowattData };