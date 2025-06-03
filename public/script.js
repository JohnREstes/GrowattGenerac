//script.js

// No Socket.IO here anymore
let currentDeviceId = null;
let pollIntervalId = null; // To store the interval for polling

// Function to fetch the device state from the server
async function fetchDeviceState() {
    if (!currentDeviceId) {
        document.getElementById('status').innerText = 'Please select a device.';
        return;
    }

    try {
        const response = await fetch(`/espcontrol/control?deviceId=${currentDeviceId}`); // Use deviceId
        const data = await response.json(); // Expect JSON

        if (response.ok) {
            console.log(`[HTTP] Received state for device ${data.deviceId}: ${data.state}`);
            document.getElementById('pinToggle').checked = (data.state === 'ON');
            document.getElementById('status').innerText = `Current State: ${data.state}`;
        } else {
            console.error(`[HTTP] Error fetching state: ${data.error || response.statusText}`);
            document.getElementById('status').innerText = `Error: ${data.error || response.statusText}`;
        }
    } catch (error) {
        console.error('[HTTP] Fetch error:', error);
        document.getElementById('status').innerText = 'Connection error.';
    }
}

// Function to toggle the pin state on the server
async function togglePin() {
    const deviceId = getSelectedDeviceId();
    if (!deviceId) {
        alert('Please select a device.');
        return;
    }

    // Determine the desired new state based on the checkbox's *new* state after the click
    const newState = document.getElementById('pinToggle').checked ? 'ON' : 'OFF'; 

    document.getElementById('status').innerText = 'Sending toggle...';

    try {
        const response = await fetch('/espcontrol/control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ deviceId: deviceId, state: newState })
        });
        const data = await response.json();

        if (response.ok) {
            console.log(`[HTTP] Toggle successful: ${data.message}`);
            // After successful toggle, immediately fetch the new state to update the UI
            fetchDeviceState(); 
        } else {
            console.error(`[HTTP] Toggle error: ${data.error || response.statusText}`);
            document.getElementById('status').innerText = `Error: ${data.error || response.statusText}`;
        }
    } catch (error) {
        console.error('[HTTP] Toggle fetch error:', error);
        document.getElementById('status').innerText = 'Connection error during toggle.';
    }
}

function addEventRow(time = '', state = 'ON') {
    const container = document.createElement('div');
    container.className = 'event-row';

    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.value = time;

    const stateSelect = document.createElement('select');
    ['ON', 'OFF'].forEach(s => {
        const opt = document.createElement('option');
        // FIX: Use opt.textContent instead of opt.text for consistency
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

    const timezone = document.getElementById('timezone').value; // Get selected timezone

    try {
        const response = await fetch(`/espcontrol/api/schedule/${deviceId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ events, timezone }), // Send timezone with events
        });

        const statusMessage = document.getElementById('saveStatus');
        if (response.ok) {
            statusMessage.textContent = 'Schedule saved successfully!';
            statusMessage.style.color = 'green';
        } else {
            const errorData = await response.text();
            statusMessage.textContent = `Failed to save schedule: ${errorData}`;
            statusMessage.style.color = 'red';
            console.error('Failed to save schedule:', response.status, errorData);
        }
        setTimeout(() => statusMessage.textContent = '', 3000);
    } catch (error) {
        console.error('Error saving schedule:', error);
        document.getElementById('saveStatus').textContent = 'Network error saving schedule.';
        document.getElementById('saveStatus').style.color = 'red';
    }
}


async function loadSchedule() {
    const deviceId = getSelectedDeviceId();
    if (!deviceId) {
        document.getElementById('events').innerHTML = '<p>Select a device to load its schedule.</p>';
        return;
    }

    try {
        const response = await fetch(`/espcontrol/api/schedule/${deviceId}`);
        const data = await response.json(); // Expect { events: [...], timezone: "..." }
        
        const eventsContainer = document.getElementById('events');
        eventsContainer.innerHTML = ''; // Clear existing events

        if (data.timezone) { // Set timezone dropdown
            document.getElementById('timezone').value = data.timezone;
        }

        if (data.events && data.events.length > 0) {
            data.events.forEach(event => addEventRow(event.time, event.state));
        } else {
            eventsContainer.innerHTML = '<p>No schedule found. Add new events.</p>';
        }
    } catch (error) {
        console.error('Error loading schedule:', error);
        document.getElementById('events').innerHTML = '<p>Error loading schedule.</p>';
    }
}


// Helper to get selected device ID
function getSelectedDeviceId() {
    const select = document.getElementById('deviceSelect');
    return select.value;
}

// Load devices from the server and populate the dropdown
async function loadDevices() {
    try {
        const response = await fetch('/espcontrol/api/devices');
        const devices = await response.json();
        const select = document.getElementById('deviceSelect');
        select.innerHTML = '<option value="">-- Choose Device --</option>'; // Clear existing options

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

        // If only one device, auto-select and fetch its state/schedule
        if (devices.length === 1) {
            currentDeviceId = devices[0].id;
            select.value = currentDeviceId;
            document.getElementById('status').innerText = 'Fetching state...';
            startPolling(); // Start polling immediately
            loadSchedule();
        }

        // Add event listener for manual selection (if more than one device)
        select.addEventListener('change', () => {
            currentDeviceId = getSelectedDeviceId();
            if (!currentDeviceId) {
                document.getElementById('status').innerText = 'Please select a device.';
                stopPolling(); // Stop polling if no device is selected
                return;
            }
            document.getElementById('status').innerText = 'Fetching state...';
            startPolling(); // Start/restart polling for the selected device
            loadSchedule();
        });
    } catch (err) {
        document.getElementById('status').innerText = 'Error loading devices.';
        console.error('[LOAD] Failed to load devices', err);
    }
}

// Start polling for device state
function startPolling() {
    if (pollIntervalId) {
        clearInterval(pollIntervalId); // Clear any existing interval
    }
    // Poll every 3 seconds (adjust to match ESP's polling or your needs)
    pollIntervalId = setInterval(fetchDeviceState, 3000); 
    fetchDeviceState(); // Fetch immediately on start
}

// Stop polling for device state
function stopPolling() {
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
    }
}


window.onload = () => {
    console.log('[CLIENT] Page loaded, loading devices...');
    loadDevices();
    // Polling will start after a device is selected by loadDevices()
};