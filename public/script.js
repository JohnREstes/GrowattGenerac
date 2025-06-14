let currentDeviceId = null;
let pollIntervalId = null; // To store the interval for polling

// --- Helper Functions ---
function getSelectedDeviceId() {
    const select = document.getElementById('deviceSelect');
    return select.value;
}

async function fetchData(url, method = 'GET', body = null) {
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    const text = await response.text();
    try {
        const json = JSON.parse(text);
        return { ok: response.ok, data: json, status: response.status };
    } catch (e) {
        return { ok: response.ok, data: { error: text || response.statusText }, status: response.status };
    }
}

// --- Device Control Functions ---
async function fetchDeviceState() {
    if (!currentDeviceId) {
        document.getElementById('status').innerText = 'Please select a device.';
        return;
    }

    const { ok, data, status } = await fetchData(`/espcontrol/control?deviceId=${currentDeviceId}`);

    if (ok) {
        console.log(`[HTTP] Received state for device ${data.deviceId}: ${data.state}`);
        document.getElementById('pinToggle').checked = (data.state === 'ON');
        document.getElementById('status').innerText = `Current State: ${data.state}`;
    } else {
        console.error(`[HTTP] Error fetching state: ${data.error || status}`);
        document.getElementById('status').innerText = `Error: ${data.error || status}`;
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

    const { ok, data, status } = await fetchData('/espcontrol/control', 'POST', { deviceId: deviceId, state: newState });

    if (ok) {
        console.log(`[HTTP] Toggle successful: ${data.message}`);
        fetchDeviceState();
    } else {
        console.error(`[HTTP] Toggle error: ${data.error || status}`);
        document.getElementById('status').innerText = `Error: ${data.error || status}`;
    }
}

// --- Schedule Functions ---
function addEventRow(time = '', state = 'ON') {
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
    deleteBtn.textContent = 'x';
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
    if (!deviceId) return alert('Please select a device to save schedule for.');

    const events = [];
    document.querySelectorAll('.event-row').forEach(row => {
        const time = row.querySelector('input[type="time"]').value;
        const state = row.querySelector('select').value;
        if (time && state) {
            events.push({ time, state });
        }
    });

    const timezone = document.getElementById('timezone').value;

    const { ok, data, status } = await fetchData(`/espcontrol/api/schedule/${deviceId}`, 'POST', { events, timezone });

    const statusMessage = document.getElementById('saveStatus');
    if (ok) {
        statusMessage.textContent = 'Schedule saved successfully!';
        statusMessage.style.color = 'green';
    } else {
        statusMessage.textContent = `Failed to save schedule: ${data.error}`;
        statusMessage.style.color = 'red';
        console.error('Failed to save schedule:', status, data.error);
    }
    setTimeout(() => statusMessage.textContent = '', 3000);
}

async function loadSchedule() {
    const deviceId = getSelectedDeviceId();
    if (!deviceId) {
        document.getElementById('events').innerHTML = '<p>Select a device to load its schedule.</p>';
        return;
    }

    const { ok, data, status } = await fetchData(`/espcontrol/api/schedule/${deviceId}`);

    const eventsContainer = document.getElementById('events');
    eventsContainer.innerHTML = '';

    if (ok) {
        if (data.timezone) {
            document.getElementById('timezone').value = data.timezone;
        }

        if (data.events && data.events.length > 0) {
            data.events.forEach(event => addEventRow(event.time, event.state));
        } else {
            eventsContainer.innerHTML = '<p>No schedule found. Add new events.</p>';
        }
    } else {
        console.error('Error loading schedule:', status, data.error);
        eventsContainer.innerHTML = '<p>Error loading schedule.</p>';
    }
}

// --- Device List Loading ---
async function loadDevices() {
    try {
        const { ok, data: devices, status } = await fetchData('/espcontrol/api/devices');
        const select = document.getElementById('deviceSelect');
        select.innerHTML = '<option value="">-- Choose Device --</option>';

        if (!ok) {
            document.getElementById('status').innerText = `Error loading devices: ${devices.error}`;
            console.error('[LOAD] Failed to load devices', status, devices.error);
            return;
        }

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

        if (devices.length === 1) {
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
    } catch (err) {
        document.getElementById('status').innerText = 'Error loading devices.';
        console.error('[LOAD] Failed to load devices', err);
    }
}

// --- Polling Logic ---
function startPolling() {
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
    }
    pollIntervalId = setInterval(fetchDeviceState, 3000);
    fetchDeviceState();
}

function stopPolling() {
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
    }
}

// --- Growatt Integration Functions ---

// Function to render details and update controls for a Growatt integration
function renderGrowattIntegrationDetails(integration, containerElement) {
    containerElement.innerHTML = `
        <p><strong>Name:</strong> ${integration.name}</p>
        <p><strong>Type:</strong> ${integration.integration_type}</p>
        <p><strong>Server:</strong> ${integration.settings.server || 'N/A'}</p>
        <p><strong>Saved Plant ID:</strong> <span id="currentPlantId-${integration.id}">${integration.settings.plantId || 'None Set'}</span></p>
        <p><strong>Saved Device Serials:</strong> <span id="currentDeviceSerials-${integration.id}">${(integration.settings.deviceSerialNumbers && integration.settings.deviceSerialNumbers.length > 0) ? integration.settings.deviceSerialNumbers.join(', ') : 'None Set'}</span></p>

        <button class="fetch-growatt-data-btn" data-integration-id="${integration.id}">Fetch Growatt Data</button>
        <div id="growattDataDisplay-${integration.id}" style="display:none; margin-top: 10px; border-top: 1px solid #eee; padding-top: 5px;">
            <h4>Raw Growatt Data:</h4>
            <pre id="growattRawData-${integration.id}" style="max-height: 200px; overflow-y: scroll; background-color: #f8f8f8; padding: 10px; border: 1px solid #ddd;"></pre>
            
            <div style="margin-top: 15px;">
                <h4>Discovered Growatt Plants & Devices:</h4>
                <ul id="discoveredPlants-${integration.id}"></ul>
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
    `;

    // Add event listener for Fetch Growatt Data button
    containerElement.querySelector(`.fetch-growatt-data-btn`).onclick = async () => {
        await fetchGrowattData(integration.id);
    };

    // Add event listener for Update Settings button
    containerElement.querySelector(`.update-growatt-settings-btn`).onclick = async () => {
        const newPlantId = containerElement.querySelector(`#updatePlantId-${integration.id}`).value;
        const newDeviceSerialsInput = containerElement.querySelector(`#updateDeviceSerials-${integration.id}`).value;
        const newDeviceSerialNumbers = newDeviceSerialsInput.split(',').map(s => s.trim()).filter(s => s);

        const updatedSettings = {
            ...integration.settings, // Keep existing settings
            plantId: newPlantId,
            deviceSerialNumbers: newDeviceSerialNumbers
        };

        const updateStatusElement = containerElement.querySelector(`#updateStatus-${integration.id}`);
        updateStatusElement.textContent = 'Updating...';
        updateStatusElement.style.color = 'gray';

        const { ok, data, status } = await fetchData(`/espcontrol/api/integrations/${integration.id}`, 'PUT', {
            integration_type: integration.integration_type,
            name: integration.name,
            settings: updatedSettings
        });

        if (ok) {
            updateStatusElement.textContent = 'Settings updated successfully!';
            updateStatusElement.style.color = 'green';
            // Update displayed "Saved" values immediately
            document.getElementById(`currentPlantId-${integration.id}`).textContent = newPlantId || 'None Set';
            document.getElementById(`currentDeviceSerials-${integration.id}`).textContent = newDeviceSerialNumbers.join(', ') || 'None Set';
            // Optionally, reload all integrations to refresh the list entirely
            // loadIntegrations();
        } else {
            updateStatusElement.textContent = `Failed to update settings: ${data.error || status}`;
            updateStatusElement.style.color = 'red';
            console.error('[GROWATT] Error updating settings:', status, data.error);
        }
        setTimeout(() => updateStatusElement.textContent = '', 3000);
    };
}


async function fetchGrowattData(integrationId) {
    const growattDataDisplay = document.getElementById(`growattDataDisplay-${integrationId}`);
    const growattRawData = document.getElementById(`growattRawData-${integrationId}`);
    const discoveredPlantsUl = document.getElementById(`discoveredPlants-${integrationId}`);
    const updatePlantIdSelect = document.getElementById(`updatePlantId-${integrationId}`);

    growattRawData.textContent = 'Fetching data...';
    discoveredPlantsUl.innerHTML = '';
    updatePlantIdSelect.innerHTML = '<option value="">-- Select Plant ID --</option>'; // Clear and add default
    growattDataDisplay.style.display = 'block';

    const { ok: growattOk, data: growattResponseData, status: growattStatus } = await fetchData(`/espcontrol/api/integrations/growatt/${integrationId}/data`);

    if (growattOk) {
        growattRawData.textContent = JSON.stringify(growattResponseData, null, 2);
        console.log('[GROWATT] Data fetched successfully:', growattResponseData);

        // Populate Discovered Plants & Devices section
        // Assuming growattResponseData.allRawPlantData is the key where the full data from growatt.getAllPlantData({}) resides
        const rawPlantsFromBackend = growattResponseData.allRawPlantData;

        if (typeof rawPlantsFromBackend === 'object' && rawPlantsFromBackend !== null && !Array.isArray(rawPlantsFromBackend)) {
            for (const plantId in rawPlantsFromBackend) {
                if (rawPlantsFromBackend.hasOwnProperty(plantId)) {
                    const plant = rawPlantsFromBackend[plantId];
                    const plantName = plant.plantName || `Plant ${plantId}`; // Growatt often has a plantName
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
            // Set current plantId in dropdown if it was previously set
            // The original integration object (passed to renderGrowattIntegrationDetails) holds the saved plantId
            // So we need to get the integration's current settings.plantId
            const integrationItem = await fetchData(`/espcontrol/api/integrations/${integrationId}`);
            if (integrationItem.ok && integrationItem.data.settings && integrationItem.data.settings.plantId) {
                updatePlantIdSelect.value = integrationItem.data.settings.plantId;
            }
        } else {
             discoveredPlantsUl.innerHTML = '<li>Could not discover plants/devices. Raw data might be malformed or empty.</li>';
        }

    } else {
        growattRawData.textContent = `Error fetching Growatt data: ${growattResponseData.error || growattStatus}`;
        console.error('[GROWATT] Error fetching data:', growattStatus, growattResponseData.error);
    }
}


async function loadIntegrations() {
    const integrationList = document.getElementById('integrationList');
    integrationList.innerHTML = '<li>Loading integrations...</li>';
    const { ok, data: integrations, status } = await fetchData('/espcontrol/api/integrations');

    if (!ok) {
        integrationList.innerHTML = `<li>Error loading integrations: ${integrations.error || status}</li>`;
        console.error('[INTEGRATIONS] Error loading integrations:', status, integrations.error);
        return;
    }

    integrationList.innerHTML = ''; // Clear loading message

    if (integrations.length === 0) {
        integrationList.innerHTML = '<li>No integrations added yet.</li>';
        return;
    }

    integrations.forEach(integration => {
        const li = document.createElement('li');
        li.style.marginBottom = '20px';
        li.style.border = '1px solid #ccc';
        li.style.padding = '10px';
        li.style.borderRadius = '5px';

        if (integration.integration_type === 'Growatt') {
            renderGrowattIntegrationDetails(integration, li);
        } else {
            li.textContent = `${integration.name} (${integration.integration_type})`;
            // You can add more details for other integration types here
        }
        integrationList.appendChild(li);
    });
}

// Handle form submission for adding new Growatt integration
document.addEventListener('DOMContentLoaded', () => {
    const addGrowattIntegrationForm = document.getElementById('addGrowattIntegrationForm');
    if (addGrowattIntegrationForm) {
        addGrowattIntegrationForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission

            const name = document.getElementById('growattIntegrationName').value;
            const username = document.getElementById('growattUsername').value;
            const password = document.getElementById('growattPassword').value;
            const server = document.getElementById('growattServer').value;
            // These fields are now optional, can be empty strings
            const plantId = document.getElementById('growattPlantId').value;
            const deviceSerialsInput = document.getElementById('growattDeviceSerials').value;
            // Only split and filter if the input is not empty
            const deviceSerialNumbers = deviceSerialsInput ? deviceSerialsInput.split(',').map(s => s.trim()).filter(s => s) : [];

            const integrationData = {
                integration_type: 'Growatt', // Fixed type
                name: name,
                settings: {
                    username: username,
                    password: password,
                    server: server,
                    plantId: plantId,
                    deviceSerialNumbers: deviceSerialNumbers
                }
            };

            const { ok, data, status } = await fetchData('/espcontrol/api/integrations', 'POST', integrationData);

            if (ok) {
                alert(`Integration "${name}" added successfully!`);
                addGrowattIntegrationForm.reset(); // Clear form
                loadIntegrations(); // Reload list to show new integration
            } else {
                alert(`Failed to add integration: ${data.error || status}`);
                console.error('[INTEGRATIONS] Failed to add integration:', status, data.error);
            }
        });
    }
});


// --- Initial Page Load ---
window.onload = () => {
    console.log('[CLIENT] Page loaded, loading devices and integrations...');
    loadDevices();
    loadIntegrations(); // Load integrations when the page loads
};