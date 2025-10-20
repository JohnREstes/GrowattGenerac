// integrations/growattScraper.js

const { chromium } = require('playwright');

async function scrapeGrowattData({ username, password }) {
  console.log('Starting Growatt login via Playwright...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://server.growatt.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Fill credentials
    await page.fill('#account', username);
    await page.fill('#password', password);
    await page.click('#btnLogin');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('Login successful. Navigating dashboard.');

    // Wait until dashboard fully loads
    await page.waitForSelector('.content', { timeout: 30000 });

    // Extract summary info
    const data = await page.evaluate(() => {
      const safeText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : 'N/A';
      };

      const parseNumber = (v) => {
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };

      return {
        systemStatus: safeText('#systemStatus') || 'N/A',
        batteryVoltage: parseNumber(safeText('#batteryVoltage')) || 'N/A',
        pvPower1: parseNumber(safeText('#pvPower1')) || 0,
        pvPower2: parseNumber(safeText('#pvPower2')) || 0,
        pvPower3: parseNumber(safeText('#pvPower3')) || 0,
        acOutputPower: parseNumber(safeText('#acOutputPower')) || 0,
        acInputPower: parseNumber(safeText('#acInputPower')) || 0,
        batteryPower: parseNumber(safeText('#batteryPower')) || null,
        batteryPercentage: parseNumber(safeText('#batterySOC')) || null,
        solarPanelPower: parseNumber(safeText('#solarPanelPower')) || 0,
        consumption: parseNumber(safeText('#loadPower')) || 0
      };
    });

    // --- Fetch SPH Battery Chart (Authenticated inside browser context) ---
    let socPercentage = null;
    try {
      const socData = await page.evaluate(async (deviceSn) => {
        const formData = new URLSearchParams();
        formData.append('deviceSn', deviceSn);

        const response = await fetch('/panel/sph/getSPHBatChart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData
        });

        // Parse as JSON
        return await response.json();
      }, 'KQQ2N9L03Q'); // <-- Your inverter serial number here

      const socArray = socData?.obj?.socChart?.soc || [];
      socPercentage = socArray.reverse().find(v => v !== null);
      console.log('[Scraper] Battery SOC (from chart):', socPercentage);
    } catch (err) {
      console.warn('[Scraper] Failed to fetch SPH battery chart:', err.message);
    }

    // Merge SOC value if available
    if (socPercentage) data.batteryPercentage = socPercentage;

    console.log('Scraped data:', data);

    await browser.close();
    return data;

  } catch (err) {
    console.error('Playwright scraping failed:', err);
    await browser.close();
    throw err;
  }
}

module.exports = { scrapeGrowattData };
