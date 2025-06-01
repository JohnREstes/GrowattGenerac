// script.js

const socket = io({ path: '/espcontrol/socket.io' });
let currentDeviceId = null;
let responseTimeout = null;

// Handle incoming state updates
socket.on('state', ({ deviceId, state }) => {
  console.log(`[SOCKET] Received state for device ${deviceId}: ${state}`);
  if (deviceId !== currentDeviceId) return;

  clearTimeout(responseTimeout); // Clear fallback if response arrives
  document.getElementById('pinToggle').checked = (state === 'ON');
  document.getElementById('status').innerText = `Current State: ${state}`;
});

function togglePin() {
  const deviceId = getSelectedDeviceId();
  if (!deviceId) return alert('Please select a device.');

  // Temporarily show loading or indicate change in progress
  document.getElementById('status').innerText = 'Sending toggle...';

  socket.emit('toggle', deviceId);

  // Optional: fallback timeout in case the state update fails
  // Increase this value from 3000 (3 seconds) to something like 25000-30000 (25-30 seconds)
  responseTimeout = setTimeout(() => { // Assign to responseTimeout
    if (document.getElementById('status').innerText === 'Sending toggle...') {
      document.getElementById('status').innerText = 'No response from device.';
    }
  }, 25000); // <-- CHANGE THIS VALUE
}

// ... (rest of your functions: addEventRow, addEvent, getSelectedDeviceId, saveSchedule, loadSchedule) ...

function loadDevices() {
  fetch('/espcontrol/api/devices')
    .then(res => res.json())
    .then(devices => {
      const select = document.getElementById('deviceSelect');
      const statusLabel = document.getElementById('status');
      select.innerHTML = '<option value="">-- Choose Device --</option>';

      devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.text = d.device_name;
        select.appendChild(opt);
      });

      if (devices.length === 0) {
        statusLabel.innerText = 'No devices available.';
        return;
      }

      // If only one device, auto-select and fetch
      if (devices.length === 1) {
        currentDeviceId = devices[0].id;
        select.value = currentDeviceId;
        statusLabel.innerText = 'Fetching state...';
        socket.emit('getState', currentDeviceId);
        loadSchedule();

        // Fallback in case no response
        responseTimeout = setTimeout(() => {
          if (statusLabel.innerText === 'Fetching state...') {
            statusLabel.innerText = 'No response from device.';
          }
        }, 25000); // <-- CHANGE THIS VALUE
      }

      // Handle manual selection
      select.addEventListener('change', () => {
        currentDeviceId = getSelectedDeviceId();
        if (!currentDeviceId) {
          statusLabel.innerText = 'Please select a device.';
          return;
        }
        statusLabel.innerText = 'Fetching state...';
        socket.emit('getState', currentDeviceId);
        loadSchedule();

        responseTimeout = setTimeout(() => {
          if (statusLabel.innerText === 'Fetching state...') {
            statusLabel.innerText = 'No response from device.';
          }
        }, 25000); // <-- CHANGE THIS VALUE
      });
    })
    .catch(err => {
      document.getElementById('status').innerText = 'Error loading devices.';
      console.error('[LOAD] Failed to load devices', err);
    });
}

window.onload = () => {
  socket.on('connect', () => {
    console.log('[SOCKET] Connected, now loading devices...');
    loadDevices();
  });
};