const express = require('express');
const app = express();
const port = 3020;

let pinState = 'OFF';

app.use(express.static('public'));

app.get('/control', (req, res) => res.send(pinState));

app.get('/toggle', (req, res) => {
  pinState = pinState === 'OFF' ? 'ON' : 'OFF';
  res.send(`Pin state is now: ${pinState}`);
});

app.get('/set/:state', (req, res) => {
  const state = req.params.state.toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    pinState = state;
    res.send(`Pin state set to: ${pinState}`);
  } else {
    res.status(400).send('Invalid state. Use ON or OFF.');
  }
});

app.listen(port, () => {
  console.log(`ESP control server running on http://localhost:${port}`);
});
