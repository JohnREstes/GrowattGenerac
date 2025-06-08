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
    // Attempt to parse JSON, but gracefully handle non-JSON responses (like plain text errors)
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

// --- Growatt Integration Functions (NEW) ---

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
        li.textContent = `${integration.name} (${integration.integration_type})`;

        if (integration.integration_type === 'Growatt') {
            const fetchDataButton = document.createElement('button');
            fetchDataButton.textContent = 'Fetch Growatt Data';
            fetchDataButton.style.marginLeft = '10px';
            fetchDataButton.onclick = async () => {
                const growattDataDisplay = document.getElementById('growattDataDisplay');
                const growattRawData = document.getElementById('growattRawData');
                growattRawData.textContent = 'Fetching data...';
                growattDataDisplay.style.display = 'block';

                const { ok: growattOk, data: growattData, status: growattStatus } = await fetchData(`/espcontrol/api/integrations/growatt/${integration.id}/data`);

                if (growattOk) {
                    growattRawData.textContent = JSON.stringify(growattData, null, 2);
                    console.log('[GROWATT] Data fetched successfully:', growattData);
                } else {
                    growattRawData.textContent = `Error fetching Growatt data: ${growattData.error || growattStatus}`;
                    console.error('[GROWATT] Error fetching data:', growattStatus, growattData.error);
                }
            };
            li.appendChild(fetchDataButton);
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
            const plantId = document.getElementById('growattPlantId').value;
            const deviceSerialsInput = document.getElementById('growattDeviceSerials').value;
            const deviceSerialNumbers = deviceSerialsInput.split(',').map(s => s.trim()).filter(s => s); // Split by comma, trim, filter empty

            const integrationData = {
                integration_type: 'Growatt', // Fixed type
                name: name,
                settings: {
                    username: username,
                    password: password,
                    server: server,
                    plantId: plantId,
                    deviceSerialNumbers: deviceSerialNumbers // Pass as array
                }
            };

            const { ok, data, status } = await fetchData('/espcontrol/api/integrations', 'POST', integrationData);

            if (ok) {
                alert(`Integration "${name}" added successfully!`);
                addGrowattIntegrationForm.reset(); // Clear form
                loadIntegrations(); // Reload list
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