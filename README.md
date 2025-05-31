# GrowattGenerac

A simple Node.js server to control an ESP8266MOD via GPIO (D0). Hosted on AWS EC2, with a web interface for toggling the state remotely.

## Features

- Web interface to toggle GPIO D0
- RESTful endpoint for ESP8266 to fetch state
- Arduino sketch included (polls `/control` endpoint)
- Simple deployment to EC2 (port 3020)

## Getting Started

1. Clone the repo:
   ```bash
   git clone https://github.com/JohnREstes/GrowattGenerac.git
