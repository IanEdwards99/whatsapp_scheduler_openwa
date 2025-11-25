# WhatsApp Scheduler with open-wa

This is an optimized version of WhatsApp Scheduler using `open-wa` for better performance on Raspberry Pi 3B+.

## Why open-wa?

- **Faster**: Uses WAPI (WhatsApp Web API) instead of full Selenium WebDriver
- **Lighter**: Reduced memory and CPU footprint
- **Better for Pi**: Optimized for resource-constrained devices
- **Headless**: Can run without display server

## Project Structure

```
whatsapp_scheduler_openwa/
├── server.js              # Node.js open-wa server
├── app.py                 # Flask web interface
├── scheduler.py           # Schedule management
├── package.json           # Node.js dependencies
├── requirements.txt       # Python dependencies
├── templates/             # HTML templates
├── static/                # CSS/JS static files
└── schedules/             # Schedule JSON files
```

## Setup

### Prerequisites

- Node.js >= 16.0.0
- Python >= 3.8
- WhatsApp account (for Web login)

### Installation

1. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Create schedules directory:**
   ```bash
   mkdir -p schedules
   ```

## Running

### Start the WhatsApp server (open-wa):
```bash
node server.js
```

This initializes the open-wa client and listens on port 5001.

### In another terminal, start the Flask app:
```bash
python3 app.py
```

Visit `http://localhost:5000` in your browser.

## API Endpoints

- `POST /open_whatsapp` - Ensure WhatsApp is connected
- `POST /send_message` - Send a message
  - JSON: `{"contact": "name or number", "message": "text"}`
- `POST /send_poll` - Send a poll
  - JSON: `{"contact": "name", "question": "text", "options": ["opt1", "opt2"]}`
- `GET /status` - Server health check

## Notes

- First run will require QR code scan for WhatsApp Web login
- Session is persisted automatically by open-wa
- Contacts should be names (as they appear in WhatsApp) or phone numbers
- Performance is significantly better on Raspberry Pi compared to Selenium version

## Migration from Selenium Version

The original Selenium-based version is in `../whatsapp_scheduler/`.
This version maintains the same Flask interface but uses open-wa backend for better performance.
