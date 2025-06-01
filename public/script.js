const socket = io({
  path: '/espcontrol/socket.io'
});

socket.on('state', state => {
  document.getElementById('pinToggle').checked = (state === 'ON');
  document.getElementById('status').innerText = `Current State: ${state}`;
});

document.getElementById('pinToggle').addEventListener('change', () => {
  socket.emit('toggle');
});

document.getElementById('scheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const onTime = document.getElementById('onTime').value;
  const offTime = document.getElementById('offTime').value;
  const timezone = document.getElementById('timezone').value;

  const res = await fetch('/espcontrol/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onTime, offTime, timezone })
  });

  const result = await res.json();
  alert(result.message);
});
