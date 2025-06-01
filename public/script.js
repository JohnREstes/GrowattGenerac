const socket = io({ path: '/espcontrol/socket.io' });

socket.on('state', ({ deviceId, state }) => {
  const selectedId = getSelectedDeviceId();
  if (deviceId !== selectedId) return; // Only update UI for the selected device

  document.getElementById('pinToggle').checked = (state === 'ON');
  document.getElementById('status').innerText = `Current State: ${state}`;
});

function togglePin() {
  const deviceId = getSelectedDeviceId();
  if (!deviceId) return alert('Please select a device.');
  socket.emit('toggle', deviceId);
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
    opt.value = s;
    opt.text = s;
    if (s === state) opt.selected = true;
    stateSelect.appendChild(opt);
  });

  const removeBtn = document.createElement('button');
  removeBtn.textContent = '✖';
  removeBtn.onclick = () => container.remove();

  container.appendChild(timeInput);
  container.appendChild(stateSelect);
  container.appendChild(removeBtn);

  document.getElementById('events').appendChild(container);
}

function addEvent() {
  addEventRow();
}

function getSelectedDeviceId() {
  return document.getElementById('deviceSelect').value;
}

function saveSchedule() {
  const deviceId = getSelectedDeviceId();
  if (!deviceId) return alert('Please select a device.');

  const timezone = document.getElementById('timezone').value;
  const events = Array.from(document.querySelectorAll('.event-row')).map(row => {
    return {
      time: row.querySelector('input').value,
      state: row.querySelector('select').value
    };
  });

  fetch(`/espcontrol/api/schedule/${deviceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events })
  })
    .then(res => res.text())
    .then(msg => {
      document.getElementById('saveStatus').innerText = msg;
    })
    .catch(err => {
      document.getElementById('saveStatus').innerText = 'Error saving schedule.';
      console.error(err);
    });
}

function loadSchedule() {
  const deviceId = getSelectedDeviceId();
  if (!deviceId) return;

  fetch(`/espcontrol/api/schedule/${deviceId}`)
    .then(res => res.json())
    .then(data => {
      document.getElementById('events').innerHTML = ''; // Clear existing
      if (data.timezone) {
        document.getElementById('timezone').value = data.timezone;
      }
      if (data.events) {
        data.events.forEach(event => addEventRow(event.time, event.state));
      }
    })
    .catch(err => console.error('[LOAD] Failed to load schedule', err));
}

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
        select.value = devices[0].id;
        const deviceId = devices[0].id;
        statusLabel.innerText = 'Fetching state...';
        socket.emit('getState', deviceId);
        loadSchedule();

        // Fallback timeout in case no response
        setTimeout(() => {
          if (statusLabel.innerText === 'Fetching state...') {
            statusLabel.innerText = 'No response from device.';
          }
        }, 3000);
      }

      // Listen for user selection
      select.addEventListener('change', () => {
        const deviceId = getSelectedDeviceId();
        if (!deviceId) {
          statusLabel.innerText = 'Please select a device.';
          return;
        }
        statusLabel.innerText = 'Fetching state...';
        socket.emit('getState', deviceId);
        loadSchedule();

        // Add fallback for no response
        setTimeout(() => {
          if (statusLabel.innerText === 'Fetching state...') {
            statusLabel.innerText = 'No response from device.';
          }
        }, 3000);
      });
    })
    .catch(err => {
      document.getElementById('status').innerText = 'Error loading devices.';
      console.error('[LOAD] Failed to load devices', err);
    });
}

window.onload = () => {
  loadDevices();
};
