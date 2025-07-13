/**
 * Parses a string value to a float, handling 'N/A' or non-numeric values gracefully.
 * @param {string} value The string to parse.
 * @returns {number} The parsed float, or 0 if parsing fails.
 */
function parseNumericValue(value) {
    if (typeof value === 'string') {
        const parsed = parseFloat(value.replace(/[^0-9.-]/g, '')); // Remove non-numeric chars except . and -
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0; // Return 0 for non-string, non-numeric inputs
}

/**
 * Updates the summary display spans with aggregated data from the Growatt inverter table.
 */
function updateGrowattSummaryDisplays() {
    const tableBody = document.querySelector('#growattInverterDataTable tbody');
    if (!tableBody) {
        console.warn('Growatt inverter table body not found for summary display.');
        // This can happen if the table is removed or replaced, so we just log and exit.
        // The observer on the parent will re-trigger if a new tbody is added.
        return;
    }

    let totalInputPower = 0;
    let totalLoadsPower = 0;
    let totalBatteryPower = 0;
    let totalPVPower = 0;
    let totalBatteryVoltage = 0;
    let totalBatteryPercentage = 0;
    let inverterCount = 0;

    // Iterate through each row in the table body
    // Use `children` to get a live list of <tr> elements
    Array.from(tableBody.children).forEach(row => {
        const cells = row.children;

        // Ensure there are enough cells to extract data
        if (cells.length >= 8) { // Based on your table structure: 0-7 indices
            const batteryVoltage = parseNumericValue(cells[2].textContent);
            const batteryPower = parseNumericValue(cells[3].textContent);
            const batteryPercentage = parseNumericValue(cells[4].textContent);
            const acInputPower = parseNumericValue(cells[5].textContent);
            const acOutputPower = parseNumericValue(cells[6].textContent);
            const solarPanelPower = parseNumericValue(cells[7].textContent);

            totalBatteryVoltage += batteryVoltage;
            totalBatteryPower += batteryPower;
            totalBatteryPercentage += batteryPercentage;
            totalInputPower += acInputPower;
            totalLoadsPower += acOutputPower;
            totalPVPower += solarPanelPower;
            inverterCount++;
        }
    });

    // Calculate averages for voltage and percentage if inverters exist
    const avgBatteryVoltage = inverterCount > 0 ? (totalBatteryVoltage / inverterCount).toFixed(1) : 0;
    const avgBatteryPercentage = inverterCount > 0 ? (totalBatteryPercentage / inverterCount).toFixed(0) : 0; // Round to whole number

    // Update the display spans
    const inputPowerTotalSpan = document.getElementById('inputPowerTotal');
    if (inputPowerTotalSpan) inputPowerTotalSpan.textContent = `${totalInputPower} W`;

    const loadsTotalSpan = document.getElementById('loadsTotal');
    if (loadsTotalSpan) loadsTotalSpan.textContent = `${totalLoadsPower} W`;

    const batteryPercentageSpan = document.getElementById('batteryPercentage');
    if (batteryPercentageSpan) batteryPercentageSpan.textContent = `${avgBatteryPercentage}%`;

    const batteryPowerSpan = document.getElementById('batteryPower');
    if (batteryPowerSpan) batteryPowerSpan.textContent = `${totalBatteryPower} W`;

    const batteryVoltageSpan = document.getElementById('batteryVoltage');
    if (batteryVoltageSpan) batteryVoltageSpan.textContent = `${avgBatteryVoltage} V`;

    const PVTotalSpan = document.getElementById('PVTotal');
    if (PVTotalSpan) PVTotalSpan.textContent = `${totalPVPower} W`;

    const chargingDischarge = document.getElementById('charging_discharging');
    const leftSpan = document.querySelector('.left-div span');
    const rightSpan = document.querySelector('.right-div span');
    const upDivSpan = document.querySelector('.up-div span');
    const highLeftSpan = document.querySelector('.highLeft span');
    const highRightSpan = document.querySelector('.highRight span');

    if(parseInt(totalLoadsPower) > 0){
        highRightSpan.style.animation = 'move 2s linear infinite';
        upDivSpan.style.animation = 'move 2s linear infinite';
    }
    if (parseInt(totalBatteryPower) < 0) {
        if (window.matchMedia('(max-width: 425px)').matches) {
        chargingDischarge.innerHTML = '<i class="fa-solid fa-battery-full"></i>Dischg';
        } else {
        chargingDischarge.innerHTML = `<i class="fa-solid fa-battery-full"></i>Discharging`;
        }
        leftSpan.style.animation = 'moveb 2s linear infinite';
    }  
    if (parseInt(totalBatteryPower) > 0) {
        chargingDischarge.innerHTML = '<i class="fa-solid fa-battery-full"></i>Charging';
        leftSpan.style.animation = 'move 2s linear infinite';
    }
    if(parseInt(totalPVPower) > 0){
        rightSpan.style.animation = 'moveb 2s linear infinite';        
    } else {
        rightSpan.style.animation = 'none';  
    }
    if(parseInt(totalInputPower) > 0){
        highLeftSpan.style.animation = 'moveb 2s linear infinite';  
        upDivSpan.style.animation = 'moveb 2s linear infinite';      
    } else {
        highLeftSpan.style.animation = 'none';  
    }
     if(parseInt(totalInputPower) > 0){
        highLeftSpan.style.animation = 'moveb 2s linear infinite';        
    } else {
        highLeftSpan.style.animation = 'none';  
    }   
}

function setupTableMutationObserver() {
    // We now observe the table itself, with subtree: true to catch all changes inside it.
    const tableElement = document.getElementById('growattInverterDataTable');
    if (!tableElement) {
        console.warn('Could not find Growatt inverter data table. Observer not attached.');
        return;
    }

    const observer = new MutationObserver((mutationsList, observer) => {
        console.log('[MutationObserver] Mutation detected, updating summary displays.');
        // Call the update function whenever any mutation occurs within the table
        updateGrowattSummaryDisplays();
    });

    // Observe changes to the child list and subtree (all descendants)
    const config = { childList: true, subtree: true };
    observer.observe(tableElement, config);
    console.log('[MutationObserver] Watching for changes within the entire #growattInverterDataTable...');

    // Also call it once immediately in case data is already present on load
    updateGrowattSummaryDisplays();
}

// Call the setup function when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    setupTableMutationObserver();
});

function AddAnimations(){
  if (vrmCurrentText.includes('-')) {
    if (window.matchMedia('(max-width: 425px)').matches) {
      chargingDischarge.innerHTML = '<i class="fa-solid fa-battery-full"></i>Dischg';
    } else {
      chargingDischarge.innerHTML = `<i class="fa-solid fa-battery-full"></i>Discharging`;
    }
    const element = document.querySelector('.left-div span');
    element.style.animation = 'moveb 2s linear infinite';

  } else {
    chargingDischarge.innerHTML = '<i class="fa-solid fa-battery-full"></i>Charging';
    const element = document.querySelector('.left-div span');
    element.style.animation = 'move 2s linear infinite';
  }
}


