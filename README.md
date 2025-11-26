# WhatsApp Scheduler with open-wa

This is an optimized version of WhatsApp Scheduler using `open-wa` for better performance on Raspberry Pi 3B+.

**Last updated: November 26, 2025**

## Why open-wa?

- **Faster**: Uses WAPI (WhatsApp Web API) instead of full Selenium WebDriver
- **Lighter**: Reduced memory and CPU footprint
- **Better for Pi**: Optimized for resource-constrained devices
- **Headless**: Can run without display server

## Project Structure

```
whatsapp_scheduler_openwa/
├── server.js                  # Node.js open-wa server
├── app.py                     # Flask web interface
├── scheduler_core.py          # Enhanced scheduler with locking & status
├── background_scheduler.py    # Background process for schedules
├── process_manager.py         # Process supervision & auto-restart
├── package.json               # Node.js dependencies
├── requirements.txt           # Python dependencies
├── templates/                 # HTML templates
├── static/                    # CSS/JS static files
├── schedules/                 # Schedule JSON files
├── systemd/                   # Systemd service files (optional)
├── start_all.sh               # Helper script to start all services
├── stop_all.sh                # Helper script to stop all services
├── setup_logs.sh              # Setup logging directories
└── test_system.py             # System test script
```

## Features

✅ **Status Tracking**: Schedules marked as `pending`, `completed`, or `failed`  
✅ **Recurring Schedules**: Auto-generate next occurrence for daily/weekly/monthly schedules  
✅ **File Locking**: Prevents race conditions with `fcntl` when accessing schedule data  
✅ **Process Management**: Auto-restart on crash with exponential backoff  
✅ **Group Name Resolution**: Automatically resolves group names to JIDs  
✅ **Web Interface**: Easy schedule management via Flask  
✅ **Error Recovery**: Resilient to crashes and connection issues

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

4. **Make scripts executable:**
   ```bash
   chmod +x start_all.sh stop_all.sh setup_logs.sh
   ```

## Running

### Option 1: Manual Start (Development)

**Terminal 1 - Driver Server:**
```bash
node server.js
```

**Terminal 2 - Background Scheduler:**
```bash
python3 background_scheduler.py
```

**Terminal 3 - Flask App:**
```bash
python3 app.py
```

Visit `http://localhost:5000` in your browser.

### Option 2: Helper Scripts (Recommended for Testing)

**Start all services:**
```bash
./start_all.sh
```

This starts the driver server, background scheduler, and Flask app in the background.  
Logs are written to `logs/driver.log`, `logs/scheduler.log`, and `logs/flask.log`.

**Stop all services:**
```bash
./stop_all.sh
```

### Option 3: Process Manager (Auto-Restart on Crash)

**Single Command:**
```bash
python3 process_manager.py
```

This starts and supervises both the driver server and background scheduler with automatic restart on crash.  
Start Flask separately if needed:
```bash
python3 app.py
```

### Option 4: Systemd Services (Production)

**Install services:**
```bash
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-driver whatsapp-scheduler whatsapp-flask
sudo systemctl start whatsapp-driver whatsapp-scheduler whatsapp-flask
```

**Check status:**
```bash
sudo systemctl status whatsapp-driver
sudo systemctl status whatsapp-scheduler
sudo systemctl status whatsapp-flask
```

**View logs:**
```bash
sudo journalctl -u whatsapp-driver -f
sudo journalctl -u whatsapp-scheduler -f
sudo journalctl -u whatsapp-flask -f
```

## API Endpoints

### Driver Server (port 5001)
- `GET /status` - Health check
- `GET /get_groups` - List all groups with JIDs
- `POST /open_whatsapp` - Ensure WhatsApp connected
- `POST /send_message` - Send message
  - JSON: `{"contact": "name or number", "message": "text"}`
- `POST /send_poll` - Send poll
  - JSON: `{"contact": "name", "question": "text", "options": ["opt1", "opt2"]}`

### Flask App (port 5000)
- `GET /` - Main page (list schedules)
- `GET /add` - Add new schedule form
- `POST /add` - Submit new schedule
- `GET /delete/<index>` - Delete schedule
- `GET /send_now` - Send message/poll immediately
- `GET /overview` - Full schedule overview
- `GET /api/status` - Health check

## Schedule Format

Schedules are stored in `schedules/schedule.json`:

```json
[
  {
    "type": "message",
    "contact": "+31 6 87758933",
    "message": "Hello!",
    "time": "14:30",
    "recurring": "daily",
    "status": "pending",
    "next_run": "14:30",
    "last_run": null,
    "attempts": 0,
    "created_at": "2025-01-15T10:00:00"
  }
]
```

**Status Values:**
- `pending` - Waiting to be sent
- `completed` - Successfully sent
- `failed` - Send attempt failed

**Recurring Options:**
- `null` or `""` - Send once
- `"daily"` - Every day at same time
- `"weekly"` - Every 7 days
- `"monthly"` - Every 30 days

## Testing

Run the comprehensive test script:

```bash
python3 test_system.py
```

This will test:
- Driver server connection
- Group name resolution
- Message sending to contact
- Message sending to group
- Poll sending
- Schedule creation and status tracking
- Recurring schedule logic

## How It Works

### Status Tracking
- Schedules start with `status: "pending"`
- When sent successfully, marked as `completed`
- If sending fails, marked as `failed`
- Only `pending` schedules are processed

### Recurring Logic
1. When a recurring schedule completes successfully
2. System marks original as `completed`
3. Creates new schedule with next occurrence time
4. New schedule has `status: "pending"`
5. Process repeats automatically

### File Locking
- Uses `fcntl` (Linux file locking) to prevent race conditions
- All schedule file access is wrapped in lock context manager
- Flask app and background scheduler safely share schedule data
- No conflicts between simultaneous reads/writes

### Process Management
- `process_manager.py` supervises driver and scheduler processes
- Health checks every 10 seconds
- Auto-restart with exponential backoff on crash
- Max 5 restart attempts before giving up
- Graceful cleanup on exit

## Notes

- First run requires QR code scan for WhatsApp Web
- Session persisted automatically by open-wa in `_IGNORE_whatsapp_scheduler/`
- Contacts can be names (from WhatsApp), phone numbers, or group JIDs
- Group names auto-resolved to JIDs for reliability
- File locking prevents race conditions between processes
- Process manager handles crashes with exponential backoff
- Background scheduler checks every 10 seconds (configurable)

## Troubleshooting

**Driver won't start:**
- Check Node.js version: `node --version` (>= 16.0.0)
- Check if Chromium installed: `/usr/bin/chromium-browser --version`
- Check logs: `tail -f logs/driver.log` or `journalctl -u whatsapp-driver -f`

**Schedules not sending:**
- Verify driver ready: `curl http://localhost:5001/status`
- Check background scheduler running: `ps aux | grep background_scheduler`
- Check schedule file: `cat schedules/schedule.json`
- Check scheduler logs: `tail -f logs/scheduler.log`

**Group messages failing:**
- Fetch group JID: `node get_groups.mjs`
- Use exact group name or JID in schedule
- Check group name resolution in logs

**File lock issues:**
- Ensure processes run as same user
- Check file permissions on `schedules/schedule.json`
- Look for stale lock files: `ls -la schedules/*.lock`

**Process manager issues:**
- Check if ports are already in use: `lsof -i :5001` and `lsof -i :5000`
- Kill existing processes: `./stop_all.sh`
- Restart: `python3 process_manager.py`

## Migration from Selenium Version

This version maintains the same Flask interface but uses open-wa backend for better performance on Raspberry Pi 3B+.

**Key Differences:**
- Replaced Selenium with open-wa for lighter footprint
- Added status tracking for schedules
- Added recurring schedule support
- Added file locking for race condition prevention
- Added process management for auto-recovery
- Improved error handling and logging

## Development

**Run tests:**
```bash
python3 test_system.py
```

**View real-time logs:**
```bash
tail -f logs/driver.log logs/scheduler.log logs/flask.log
```

**Check schedule status:**
```bash
cat schedules/schedule.json | jq
```

**Manual testing via API:**
```bash
# Check status
curl http://localhost:5001/status

# Get groups
curl http://localhost:5001/get_groups

# Send message
curl -X POST http://localhost:5001/send_message \
  -H "Content-Type: application/json" \
  -d '{"contact": "+31 6 87758933", "message": "Test"}'
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with `test_system.py`
5. Submit a pull request

## License

See LICENSE file for details.
