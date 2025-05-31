const express = require('express');
const cors = require('cors');
const app = express();
const port = 3020;

let pinState = 'OFF';

app.use(cors());
app.use(express.static('public'));

app.get('/control', (req, res) => {
  res.send(pinState); // ESP checks this
});

app.get('/toggle', (req, res) => {
  pinState = pinState === 'OFF' ? 'ON' : 'OFF';
  res.redirect('/');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
