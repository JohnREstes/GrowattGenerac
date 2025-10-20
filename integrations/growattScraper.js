// integrations/growattScraper.js
const { chromium } = require('playwright-chromium');

/**
 * Scrapes Growatt inverter data using Playwright.
 * Supports SPH inverters that require dashboard scraping and SOC chart retrieval.
 * @param {string} username - Growatt account username.
 * @param {string} password - Growatt account password.
 * @param {string} inverterSerial - Inverter serial number (e.g., "KQQ2N9L03Q").
 */
async function scrapeGrowattData(username, password, inverterSerial) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('[Scraper] Starting Growatt login via Playwright...');
    await page.goto('https://server.growatt.com/', { waitUntil: 'domcontentloaded' });

    // --- Login ---
    await page.fill('#val_loginAccount', username);
    await page.fill('#val_loginPwd', password);
    await page.click('button.loginB');

    // --- Smarter dashboard detection ---
    await Promise.race([
      page.waitForURL('**/index', { timeout: 60000 }),
      page.waitForSelector('.val_vBat', { timeout: 60000 }),
      page.waitForSelector('.highcharts-container', { timeout: 60000 }),
    ]);

    // Sometimes dashboard elements take longer to render
    if (!(await page.$('.val_vBat'))) {
      console.log('[Scraper] Dashboard not ready, refreshing once...');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.val_vBat', { timeout: 30000 });
    }

    console.log('[Scraper] Login successful, dashboard loaded.');

    // Hover to trigger dashboard metric updates
    await page.hover('.tips.w').catch(() => {});
    await page.waitForFunction(() => {
      const el = document.querySelector('.val_vBat');
      return el && el.textContent.trim() && el.textContent.trim() !== '-';
    }, { timeout: 30000 });

    // --- Fetch SPH Battery Chart (SOC) ---
    let socPercentage = null;
    try {
      const socResponse = await page.request.fetch(
        'https://server.growatt.com/panel/sph/getSPHBatChart',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `deviceSn=${encodeURIComponent(inverterSerial || 'KQQ2N9L03Q')}`,
        }
      );

      const text = await socResponse.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Got HTML instead of JSON (likely missing session cookie)');
      }

      const socJson = JSON.parse(text);
      const socArray = socJson?.obj?.socChart?.soc || [];
      socPercentage = socArray.slice().reverse().find(v => v != null);
      console.log(`[Scraper] Battery SOC (from chart for ${inverterSerial}):`, socPercentage);
    } catch (err) {
      console.warn('[Scraper] Failed to fetch SPH battery chart:', err.message);
    }

    // --- Main Dashboard Data Extraction ---
    const inverterMetrics = await page.evaluate(() => {
      const extractValue = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const match = el.textContent.trim().match(/([\d.]+)/);
        return match ? parseFloat(match[1]) : el.textContent.trim() || null;
      };

      const findByLabel = (label) => {
        const el = Array.from(document.querySelectorAll('div.abs')).find(div => {
          const t = div.querySelector('span.text');
          return t && t.textContent.includes(label);
        });
        const val = el?.querySelector('span.val');
        if (!val) return null;
        const match = val.textContent.trim().match(/([\d.]+)/);
        return match ? parseFloat(match[1]) : val.textContent.trim();
      };

      const statusEl = document.querySelector('.valc + .val');
      const systemStatus = statusEl ? statusEl.textContent.trim() : 'N/A';

      const data = {
        systemStatus,
        batteryVoltage: extractValue('.val_vBat'),
        pvPower1: extractValue('.val_pPv1'),
        pvPower2: extractValue('.val_pPv2'),
        pvPower3: extractValue('.val_pPv3'),
        acOutputPower: findByLabel('Consumption'),
        acInputPower: findByLabel('Generator Rated Power'),
        batteryPower: extractValue('.val_batP'),
        batteryPercentage: extractValue('.val_batCap'),
      };

      data.solarPanelPower =
        (data.pvPower1 || 0) + (data.pvPower2 || 0) + (data.pvPower3 || 0);
      data.consumption = findByLabel('Consumption');
      return data;
    });

    // Merge SOC value from chart if available
    if (socPercentage) inverterMetrics.batteryPercentage = socPercentage;

    console.log('[Scraper] Scraped data:', inverterMetrics);
    return inverterMetrics;

  } catch (error) {
    console.error('[Scraper] Playwright scraping failed:', error);
    return {
      systemStatus: 'N/A',
      batteryVoltage: 'N/A',
      batteryPower: 'N/A',
      batteryPercentage: 'N/A',
      acInputPower: 'N/A',
      acOutputPower: 'N/A',
      solarPanelPower: 'N/A',
      error: error.message,
    };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrapeGrowattData };
