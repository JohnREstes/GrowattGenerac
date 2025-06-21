let currentDeviceId = null;
let pollIntervalId = null; // To store the interval for polling
let growattDataRefreshInterval = null; // To store the interval for Growatt data polling

// --- Helper Functions ---
function getSelectedDeviceId() {
    const select = document.getElementById('deviceSelect');
    return select.value;
}

async function fetchData(url, method = 'GET', body = null) {
    try {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        // Retrieve the JWT token from localStorage
        const token = localStorage.getItem('jwtToken');
        if (token) {
            // Add the Authorization header if a token exists
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, options);

        // --- NEW: Handle 401/403 responses for redirection ---
        if (response.status === 401 || response.status === 403) {
            console.warn('Authentication error (401/403) during API fetch. Redirecting to login.');
            // Clear any potentially stale token
            localStorage.removeItem('jwtToken');
            // Redirect to login page
            window.location.href = '/espcontrol/login.html';
            // Throw an error to stop further processing in the calling function
            throw new Error('Unauthorized or Forbidden access. Redirecting...');
        }
        // --- END NEW ---

        // Always try to parse JSON, even if response is not ok, as backend might send error messages as JSON
        const text = await response.text();
        let json = {};
        try {
            json = JSON.parse(text);
        } catch (e) {
            json.error = text || response.statusText; // If not JSON, use raw text or status text as error
        }

        if (!response.ok) {
            throw new Error(json.error || response.statusText || 'Something went wrong');
        }
        return json; // Return the parsed JSON data directly
    } catch (error) {
        console.error('Fetch error:', error);
        // Important: Re-throw if it's not the redirection error handled above
        // This ensures calling functions can still catch network errors or other issues
        throw error;
    }
}

// --- Device Control Functions ---
async function fetchDeviceState() {
    if (!currentDeviceId) {
        document.getElementById('status').innerText = 'Please select a device.';
        return;
    }

    try {
        const data = await fetchData(`/espcontrol/control?deviceId=${currentDeviceId}`); // No .ok check needed, fetchData throws
        console.log(`[HTTP] Received state for device ${data.deviceId}: ${data.state}`);
        document.getElementById('pinToggle').checked = (data.state === 'ON');
        document.getElementById('status').innerText = `Current State: ${data.state}`;
    } catch (error) {
        console.error(`[HTTP] Error fetching state: ${error.message}`);
        document.getElementById('status').innerText = `Error: ${error.message}`;
    }
}

async function togglePin() {
    const deviceId = getSelectedDeviceId();
    if (!deviceId) {
        alert('Please select a device.');
        return;
    }

    const newState = document.getElementById('pinToggle').checked ? 'ON' : 'OFF';
    document.getElementById('status').innerText = 'Sending toggle...';

    try {
        const data = await fetchData('/espcontrol/control', 'POST', { deviceId: deviceId, state: newState }); // No .ok check needed
        console.log(`[HTTP] Toggle successful: ${data.message}`);
        fetchDeviceState();
    } catch (error) {
        console.error(`[HTTP] Toggle error: ${error.message}`);
        document.getElementById('status').innerText = `Error: ${error.message}`;
    }
}

// --- Schedule Functions ---
function addEventRow(time = '00:00', state = 'ON') { // Default time for new events
    const container = document.createElement('div');
    container.className = 'event-row';

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = time;

    const stateSelect = document.createElement('select');
    ['ON', 'OFF'].forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (s === state) opt.selected = true;
        stateSelect.appendChild(opt);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Remove'; // Changed from 'x' for clarity
    deleteBtn.onclick = () => container.remove();

    container.appendChild(timeInput);
    container.appendChild(stateSelect);
    container.appendChild(deleteBtn);

    document.getElementById('events').appendChild(container);
}

function addEvent() {
    addEventRow();
}

async function saveSchedule() {
    const deviceId = getSelectedDeviceId();
    if (!deviceId) {
        alert('Please select a device to save schedule for.');
        return;
    }

    const events = [];
    document.querySelectorAll('.event-row').forEach(row => {
        const time = row.querySelector('input[type="time"]').value;
        const state = row.querySelector('select').value;
        if (time && state) {
            events.push({ time, action: state }); // Use 'action' to match backend
        }
    });

    const timezone = document.getElementById('timezone').value;

    const statusMessage = document.getElementById('saveStatus');
    statusMessage.textContent = 'Saving schedule...';
    statusMessage.style.color = 'gray';

    try {
        const data = await fetchData(`/espcontrol/api/schedule/${deviceId}`, 'POST', { timezone, events });
        statusMessage.textContent = data.message;
        statusMessage.style.color = 'green';
    } catch (error) {
        statusMessage.textContent = `Failed to save schedule: ${error.message}`;
        statusMessage.style.color = 'red';
        console.error('Failed to save schedule:', error);
    }
    setTimeout(() => statusMessage.textContent = '', 3000);
}

async function loadSchedule() {
    const deviceId = getSelectedDeviceId();
    if (!deviceId) {
        document.getElementById('events').innerHTML = '<p>Select a device to load its schedule.</p>';
        return;
    }

    try {
        const data = await fetchData(`/espcontrol/api/schedule/${deviceId}`);
        const eventsContainer = document.getElementById('events');
        eventsContainer.innerHTML = ''; // Clear existing events

        if (data.timezone) {
            document.getElementById('timezone').value = data.timezone;
        }

        if (data.events && data.events.length > 0) {
            data.events.forEach(event => addEventRow(event.time, event.action)); // Use 'action'
        } else {
            eventsContainer.innerHTML = '<p>No schedule found. Add new events.</p>';
        }
    } catch (error) {
        console.error('Error loading schedule:', error);
        document.getElementById('events').innerHTML = '<p>Error loading schedule.</p>';
    }
}

// Add this to script.js after loadSchedule()

async function loadBatteryTriggers() {
    const deviceId = getSelectedDeviceId();
    if (!deviceId) return;

    try {
        const data = await fetchData(`/espcontrol/api/battery-triggers/${deviceId}`);
        const container = document.getElementById('batteryTriggers');
        container.innerHTML = '';

        if (!data.triggers || data.triggers.length === 0) {
            container.innerHTML = '<p>No battery triggers set. Use the form below to add one.</p>';
        } else {
            data.triggers.forEach(trigger => {
                const row = document.createElement('div');
                row.className = 'trigger-row';
                row.innerHTML = `
                    <strong>Inverter:</strong> ${trigger.inverter_id} | 
                    <strong>Metric:</strong> ${trigger.metric} | 
                    <strong>Turn ON below:</strong> ${trigger.turn_on_below} | 
                    <strong>Turn OFF above:</strong> ${trigger.turn_off_above} | 
                    <strong>Status:</strong> ${trigger.is_enabled ? 'Enabled' : 'Disabled'}
                    <button onclick="deleteTrigger(${trigger.id})">Delete</button>
                `;
                container.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error loading battery triggers:', error);
    }
}

async function saveBatteryTrigger() {
    const deviceId = getSelectedDeviceId();
    if (!deviceId) return alert('Please select a device.');

    const inverterId = document.getElementById('inverterId').value;
    const metric = document.getElementById('metric').value;
    const turnOn = parseFloat(document.getElementById('turnOnBelow').value);
    const turnOff = parseFloat(document.getElementById('turnOffAbove').value);

    try {
        await fetchData('/espcontrol/api/battery-triggers', 'POST', {
            deviceId, inverterId, metric,
            turn_on_below: turnOn,
            turn_off_above: turnOff
        });
        alert('Battery trigger saved.');
        loadBatteryTriggers();
    } catch (err) {
        alert(`Failed to save trigger: ${err.message}`);
    }
}

async function deleteTrigger(id) {
    try {
        await fetchData(`/espcontrol/api/battery-triggers/${id}`, 'DELETE');
        alert('Deleted trigger');
        loadBatteryTriggers();
    } catch (err) {
        alert(`Failed to delete: ${err.message}`);
    }
}

async function setIntegrationActive(integrationId, isActive) {
    try {
        await fetchData(`/espcontrol/api/integrations/${integrationId}/active`, 'POST', { isActive });
        console.log(`[CLIENT] Set integration ${integrationId} active: ${isActive}`);
    } catch (error) {
        console.warn(`Failed to set integration ${integrationId} active status:`, error.message);
    }
}

// --- Device List Loading ---
async function loadDevices() {
    try {
        const devices = await fetchData('/espcontrol/api/devices'); // No .ok check needed
        const select = document.getElementById('deviceSelect');
        select.innerHTML = '<option value="">-- Choose Device --</option>';

        if (devices.length === 0) {
            document.getElementById('status').innerText = 'No devices available.';
            return;
        }

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = device.device_name;
            select.appendChild(option);
        });

        // Autoselect first device if available
        if (devices.length > 0) {
            currentDeviceId = devices[0].id;
            select.value = currentDeviceId;
            document.getElementById('status').innerText = 'Fetching state...';
            startPolling();
            loadSchedule();
        }

        select.addEventListener('change', () => {
            currentDeviceId = getSelectedDeviceId();
            if (!currentDeviceId) {
                document.getElementById('status').innerText = 'Please select a device.';
                stopPolling();
                return;
            }
            document.getElementById('status').innerText = 'Fetching state...';
            startPolling();
            loadSchedule();
        });
    } catch (error) {
        document.getElementById('status').innerText = `Error loading devices: ${error.message}`;
        console.error('[LOAD] Failed to load devices', error);
    }
}

// --- Polling Logic ---
function startPolling() {
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
    }
    pollIntervalId = setInterval(fetchDeviceState, 3000);
    fetchDeviceState(); // Initial fetch
}

function stopPolling() {
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
    }
}

// --- INTEGRATIONS: List Existing and Add New ---
async function loadIntegrations() {
    const integrationListUl = document.getElementById('integrationList');
    integrationListUl.innerHTML = '<li>Loading integrations...</li>'; // Clear and show loading

    const growattDataStatusDiv = document.getElementById('growattDataStatus');
    let allGrowattInverters = []; // To aggregate all inverters from all Growatt integrations

    growattDataStatusDiv.textContent = 'Loading Growatt data...';
    growattDataStatusDiv.style.color = '#555';

    try {
        const integrations = await fetchData('/espcontrol/api/integrations');
        integrationListUl.innerHTML = ''; // Clear loading

        window.activeIntegrationIds = []; // ✅ Reset tracked list

        if (integrations.length === 0) {
            integrationListUl.innerHTML = '<li>No integrations added yet.</li>';
        } else {
            for (const integration of integrations) {
                if (integration.integration_type === 'Growatt') {
                    setIntegrationActive(integration.id, true);              // ✅ Mark active in DB
                    window.activeIntegrationIds.push(integration.id);        // ✅ Track for unload
                }

                const li = document.createElement('li');
                li.className = 'integration-item';
                li.innerHTML = `<strong>${integration.name}</strong> (${integration.integration_type})`;

                const detailsBtn = document.createElement('button');
                detailsBtn.textContent = 'View Details';
                detailsBtn.onclick = () => renderIntegrationDetails(integration, li);
                li.appendChild(detailsBtn);
                integrationListUl.appendChild(li);

                if (integration.integration_type === 'Growatt') {
                    try {
                        const data = await fetchData(`/espcontrol/api/growatt/data/${integration.id}`);
                        if (data.inverters && Array.isArray(data.inverters)) {
                            allGrowattInverters = allGrowattInverters.concat(data.inverters);
                        }
                    } catch (growattError) {
                        console.error(`Error fetching data for Growatt integration ${integration.id}:`, growattError);
                        const errorSpan = document.createElement('span');
                        errorSpan.style.color = 'red';
                        errorSpan.textContent = ` - Error: ${growattError.message}`;
                        li.appendChild(errorSpan);
                    }
                }
            }
        }

        // After fetching all integrations and their Growatt data, display them
        displayGrowattInvertersTable(allGrowattInverters);

    } catch (error) {
        integrationListUl.innerHTML = `<li>Error loading integrations: ${error.message}</li>`;
        integrationListUl.style.color = 'red';
        growattDataStatusDiv.textContent = `Error loading Growatt data: ${error.message}`;
        growattDataStatusDiv.style.color = 'red';
    }
}

// Function to render detailed settings for an integration (on button click)
function renderIntegrationDetails(integration, containerElement) {
    let detailsDiv = containerElement.querySelector('.integration-details');
    if (!detailsDiv) {
        detailsDiv = document.createElement('div');
        detailsDiv.className = 'integration-details';
        detailsDiv.style.marginTop = '10px';
        detailsDiv.style.borderTop = '1px solid #eee';
        detailsDiv.style.paddingTop = '10px';
        containerElement.appendChild(detailsDiv);
    }
    detailsDiv.innerHTML = ''; // Clear previous details

    if (integration.integration_type === 'Growatt') {
        detailsDiv.innerHTML = `
            <p><strong>Username:</strong> ${integration.settings.username || 'N/A'}</p>
            <p><strong>Server:</strong> ${integration.settings.server || 'N/A'}</p>
            <p><strong>Saved Plant ID:</strong> <span id="currentPlantId-${integration.id}">${integration.settings.plantId || 'None Set'}</span></p>
            <p><strong>Saved Device Serials:</strong> <span id="currentDeviceSerials-${integration.id}">${(integration.settings.deviceSerialNumbers && integration.settings.deviceSerialNumbers.length > 0) ? integration.settings.deviceSerialNumbers.join(', ') : 'None Set'}</span></p>

            <button class="fetch-growatt-data-btn" data-integration-id="${integration.id}">Fetch Raw Data & Discovered Plants</button>
            <div id="growattRawDetails-${integration.id}" style="display:none; margin-top: 10px;">
                <h4>Raw Growatt Data:</h4>
                <pre id="growattRawData-${integration.id}" style="max-height: 200px; overflow-y: scroll; background-color: #f8f8f8; padding: 10px; border: 1px solid #ddd; text-align: left;"></pre>
                
                <div style="margin-top: 15px;">
                    <h4>Discovered Growatt Plants & Devices:</h4>
                    <ul id="discoveredPlants-${integration.id}" style="text-align: left;"></ul>
                </div>

                <div style="margin-top: 15px;">
                    <h4>Update Growatt Settings:</h4>
                    <label for="updatePlantId-${integration.id}">New Plant ID:</label>
                    <select id="updatePlantId-${integration.id}" data-integration-id="${integration.id}"></select><br><br>

                    <label for="updateDeviceSerials-${integration.id}">New Device Serials (comma-separated):</label>
                    <input type="text" id="updateDeviceSerials-${integration.id}" value="${(integration.settings.deviceSerialNumbers && integration.settings.deviceSerialNumbers.length > 0) ? integration.settings.deviceSerialNumbers.join(', ') : ''}" style="width: 100%; max-width: 300px;"><br><br>
                    
                    <button class="update-growatt-settings-btn" data-integration-id="${integration.id}">Update Settings</button>
                </div>
                <p id="updateStatus-${integration.id}" style="margin-top: 5px; font-size: 0.9em;"></p>
            </div>
            <button class="delete-integration-btn" data-integration-id="${integration.id}" style="background-color: #dc3545; margin-top: 10px;">Delete Integration</button>
        `;

        // Add event listener for Fetch Raw Data & Discovered Plants button
        detailsDiv.querySelector(`.fetch-growatt-data-btn`).onclick = async () => {
            await fetchRawGrowattDataAndPlants(integration.id);
        };

        // Add event listener for Update Settings button
        detailsDiv.querySelector(`.update-growatt-settings-btn`).onclick = async () => {
            const newPlantId = detailsDiv.querySelector(`#updatePlantId-${integration.id}`).value;
            const newDeviceSerialsInput = detailsDiv.querySelector(`#updateDeviceSerials-${integration.id}`).value;
            const newDeviceSerialNumbers = newDeviceSerialsInput.split(',').map(s => s.trim()).filter(s => s);

            const updatedSettings = {
                ...integration.settings, // Keep existing settings
                plantId: newPlantId,
                deviceSerialNumbers: newDeviceSerialNumbers
            };

            const updateStatusElement = detailsDiv.querySelector(`#updateStatus-${integration.id}`);
            updateStatusElement.textContent = 'Updating...';
            updateStatusElement.style.color = 'gray';

            try {
                const data = await fetchData(`/espcontrol/api/integrations/${integration.id}`, 'PUT', {
                    integration_type: integration.integration_type,
                    name: integration.name,
                    settings: updatedSettings
                });
                updateStatusElement.textContent = 'Settings updated successfully!';
                updateStatusElement.style.color = 'green';
                // Update displayed "Saved" values immediately
                document.getElementById(`currentPlantId-${integration.id}`).textContent = newPlantId || 'None Set';
                document.getElementById(`currentDeviceSerials-${integration.id}`).textContent = newDeviceSerialNumbers.join(', ') || 'None Set';
                loadIntegrations(); // Refresh main integration list and Growatt data table
            } catch (error) {
                updateStatusElement.textContent = `Failed to update settings: ${error.message}`;
                updateStatusElement.style.color = 'red';
                console.error('[GROWATT] Error updating settings:', error);
            }
            setTimeout(() => updateStatusElement.textContent = '', 3000);
        };

        // Add event listener for Delete Integration button
        detailsDiv.querySelector(`.delete-integration-btn`).onclick = async () => {
            if (confirm(`Are you sure you want to delete the "${integration.name}" Growatt integration?`)) {
                try {
                    const data = await fetchData(`/espcontrol/api/integrations/${integration.id}`, 'DELETE');
                    alert(data.message || 'Integration deleted successfully!');
                    loadIntegrations(); // Refresh list after deletion
                } catch (error) {
                    alert('Error deleting integration: ' + error.message);
                    console.error('Error deleting integration:', error);
                }
            }
        };

    } else {
        detailsDiv.innerHTML += '<p>No specific details to display for this integration type.</p>';
    }
}

// This function fetches raw data and populates discovered plants/devices for a single integration's details view
async function fetchRawGrowattDataAndPlants(integrationId) {
    const rawDetailsDiv = document.getElementById(`growattRawDetails-${integrationId}`);
    const growattRawDataPre = document.getElementById(`growattRawData-${integrationId}`);
    const discoveredPlantsUl = document.getElementById(`discoveredPlants-${integrationId}`);
    const updatePlantIdSelect = document.getElementById(`updatePlantId-${integrationId}`);

    growattRawDataPre.textContent = 'Fetching data...';
    discoveredPlantsUl.innerHTML = '';
    updatePlantIdSelect.innerHTML = '<option value="">-- Select Plant ID --</option>'; // Clear and add default
    rawDetailsDiv.style.display = 'block';

    try {
        const growattResponseData = await fetchData(`/espcontrol/api/integrations/growatt/${integrationId}/data`);
        growattRawDataPre.textContent = JSON.stringify(growattResponseData, null, 2);
        console.log('[GROWATT] Raw Data fetched successfully:', growattResponseData);

        const rawPlantsFromBackend = growattResponseData.allRawPlantData;

        if (typeof rawPlantsFromBackend === 'object' && rawPlantsFromBackend !== null && !Array.isArray(rawPlantsFromBackend)) {
            for (const plantId in rawPlantsFromBackend) {
                if (rawPlantsFromBackend.hasOwnProperty(plantId)) {
                    const plant = rawPlantsFromBackend[plantId];
                    const plantName = plant.plantName || `Plant ${plantId}`;
                    const devices = plant.devices || {};

                    const plantLi = document.createElement('li');
                    plantLi.innerHTML = `<strong>Plant ID: ${plantId} (${plantName})</strong>`;
                    
                    const devicesUl = document.createElement('ul');
                    for (const deviceSerial in devices) {
                        if (devices.hasOwnProperty(deviceSerial)) {
                            const deviceLi = document.createElement('li');
                            deviceLi.textContent = `Device Serial: ${deviceSerial}`;
                            devicesUl.appendChild(deviceLi);
                        }
                    }
                    if (Object.keys(devices).length === 0) {
                        devicesUl.innerHTML = '<li>No devices found for this plant.</li>';
                    }
                    plantLi.appendChild(devicesUl);
                    discoveredPlantsUl.appendChild(plantLi);

                    // Add to the update Plant ID dropdown
                    const option = document.createElement('option');
                    option.value = plantId;
                    option.textContent = `${plantName} (ID: ${plantId})`;
                    updatePlantIdSelect.appendChild(option);
                }
            }
            // Set current plantId in dropdown if it was previously set for this integration
            const currentIntegration = await fetchData(`/espcontrol/api/integrations/${integrationId}`);
            if (currentIntegration.settings && currentIntegration.settings.plantId) {
                updatePlantIdSelect.value = currentIntegration.settings.plantId;
            }
        } else {
             discoveredPlantsUl.innerHTML = '<li>Could not discover plants/devices. Raw data might be malformed or empty.</li>';
        }

    } catch (error) {
        growattRawDataPre.textContent = `Error fetching Growatt data: ${error.message}`;
        console.error('[GROWATT] Error fetching data:', error);
    }
}

function displayGrowattInvertersTable(inverters) {
    const tbody = document.querySelector('#growattInverterDataTable tbody');
    const growattDataStatusDiv = document.getElementById('growattDataStatus');
    const growattInverterDataTable = document.getElementById('growattInverterDataTable');

    // Create a set of inverter IDs from the new data for efficient lookup
    const newInverterIds = new Set(inverters.map(inv => inv.inverterId));

    // Map existing rows by their inverter ID
    const existingRows = new Map();
    tbody.querySelectorAll('tr').forEach(row => {
        const inverterId = row.id.replace('inverter-row-', ''); // Assuming ID format 'inverter-row-YOUR_ID'
        existingRows.set(inverterId, row);
    });

    if (inverters.length === 0) {
        growattInverterDataTable.style.display = 'none';
        growattDataStatusDiv.textContent = 'No Growatt inverter data available. Add a Growatt integration, or check its configuration.';
        growattDataStatusDiv.style.color = '#555';
        return;
    }

    growattInverterDataTable.style.display = ''; // Ensure table is visible

    inverters.forEach(inv => {
        const rowId = `inverter-row-${inv.inverterId}`;
        let row = existingRows.get(inv.inverterId);

        if (row) {
            // Update existing row
            row.querySelector(`#${rowId}-plantName`).textContent = inv.plantName || 'N/A';
            row.querySelector(`#${rowId}-inverterId`).textContent = inv.inverterId || 'N/A';
            row.querySelector(`#${rowId}-batteryVoltage`).textContent = inv.batteryVoltage || 'N/A';
            row.querySelector(`#${rowId}-batteryPercentage`).textContent = inv.batteryPercentage || 'N/A';
            row.querySelector(`#${rowId}-acInputPower`).textContent = inv.acInputPower || 'N/A';
            row.querySelector(`#${rowId}-acOutputPower`).textContent = inv.acOutputPower || 'N/A';
            row.querySelector(`#${rowId}-solarPanelPower`).textContent = inv.solarPanelPower || 'N/A';
            existingRows.delete(inv.inverterId); // Mark as updated
        } else {
            // Create new row
            row = document.createElement('tr');
            row.id = rowId;
            row.innerHTML = `
                <td id="${rowId}-plantName">${inv.plantName || 'N/A'}</td>
                <td id="${rowId}-inverterId">${inv.inverterId || 'N/A'}</td>
                <td id="${rowId}-batteryVoltage">${inv.batteryVoltage || 'N/A'}</td>
                <td id="${rowId}-batteryPercentage">${inv.batteryPercentage || 'N/A'}</td>
                <td id="${rowId}-acInputPower">${inv.acInputPower || 'N/A'}</td>
                <td id="${rowId}-acOutputPower">${inv.acOutputPower || 'N/A'}</td>
                <td id="${rowId}-solarPanelPower">${inv.solarPanelPower || 'N/A'}</td>
            `;
            tbody.appendChild(row);
        }
    });

    // Remove rows that are no longer in the new data
    existingRows.forEach(row => row.remove());

    growattDataStatusDiv.textContent = `Growatt data refreshed: ${new Date().toLocaleTimeString()}`;
    growattDataStatusDiv.style.color = 'green';
}


// --- MODAL & FORM LOGIC for Add Growatt Integration ---
const growattIntegrationModal = document.getElementById('growattIntegrationModal');
const openGrowattModalBtn = document.getElementById('openGrowattModalBtn');
const closeButton = document.querySelector('#growattIntegrationModal .close-button');
const growattIntegrationForm = document.getElementById('growattIntegrationForm');

if (openGrowattModalBtn) {
    openGrowattModalBtn.onclick = function() {
        growattIntegrationModal.style.display = 'block';
    }
}

if (closeButton) {
    closeButton.onclick = function() {
        growattIntegrationModal.style.display = 'none';
    }
}

window.onclick = function(event) {
    if (event.target == growattIntegrationModal) {
        growattIntegrationModal.style.display = 'none';
    }
}

if (growattIntegrationForm) {
    growattIntegrationForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const formData = new FormData(growattIntegrationForm);
        const data = {
            name: formData.get('name'),
            integration_type: 'Growatt', // Fixed type
            settings: {
                username: formData.get('username'),
                password: formData.get('password'),
                server: formData.get('server'),
                plantId: formData.get('plantId') || null, // Allow null if empty
                deviceSerialNumbers: formData.get('deviceSerialNumbers') ? formData.get('deviceSerialNumbers').split(',').map(s => s.trim()).filter(s => s) : []
            }
        };

        try {
            const result = await fetchData('/espcontrol/api/integrations', 'POST', data);
            alert(result.message || 'Integration added successfully!');
            growattIntegrationForm.reset(); // Clear form
            growattIntegrationModal.style.display = 'none'; // Close modal
            loadIntegrations(); // Refresh list and data
        } catch (error) {
            alert('Error adding integration: ' + error.message);
        }
    });
}

// --- New Function for Section Toggling ---
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) {
        console.error(`Section with ID '${sectionId}' not found.`);
        return;
    }
    const content = section.querySelector('.section-content');
    const icon = section.querySelector('.toggle-section-icon');

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.classList.remove('fa-plus-square');
        icon.classList.add('fa-minus-square');
    } else {
        content.classList.add('hidden');
        icon.classList.remove('fa-minus-square');
        icon.classList.add('fa-plus-square');
    }
}


// --- Initial Page Load Functions ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('[CLIENT] Page loaded, loading devices and integrations...');
    fetchDeviceState(); // Corrected from getPinState()
    loadDevices(); // Loads devices for schedule
    loadIntegrations(); // Initial load of integrations and Growatt data

    // Set up auto-refresh for Growatt data every 30 seconds
    if (growattDataRefreshInterval) clearInterval(growattDataRefreshInterval);
    growattDataRefreshInterval = setInterval(loadIntegrations, 30000); // Refreshes all integrations & Growatt data
});

function logoutClientAndServer() {

    localStorage.removeItem('jwtToken');
    console.log('[CLIENT] JWT Token cleared from localStorage.');

    window.location.href = '/espcontrol/logout';
}

window.addEventListener('beforeunload', () => {
    if (window.activeIntegrationIds && Array.isArray(window.activeIntegrationIds)) {
        window.activeIntegrationIds.forEach(id => {
            const data = new Blob(
                [JSON.stringify({ isActive: false })],
                { type: 'application/json' }
            );
            navigator.sendBeacon(`/espcontrol/api/integrations/${id}/active`, data);
        });
    }
});