#!/bin/bash
# Daily maintenance script for WhatsApp Scheduler
#
# PURPOSE: Free leaked memory on the RPi 3B+ by restarting the driver service.
#
# IMPORTANT: This script NEVER deletes session data!
#   - whatsapp_session_store/  (browser profile with auth tokens)
#   - *.data.json              (open-wa session data)
# Deleting these would force a QR re-scan, which is not desirable for a
# headless deployment.
#
# Installation:
#   chmod +x daily_maintenance.sh
#   sudo crontab -e
#   Add: 0 4 * * * /home/iedwards/development/whatsapp_scheduler_openwa/daily_maintenance.sh

LOG_FILE="/home/iedwards/development/whatsapp_scheduler_openwa/logs/maintenance.log"
PROJECT_DIR="/home/iedwards/development/whatsapp_scheduler_openwa"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting daily maintenance" >> "$LOG_FILE"

# 1. Log memory BEFORE restart (useful for spotting leaks over time)
FREE_MEM_BEFORE=$(free -m | awk '/^Mem:/{print $4}')
echo "$(date '+%Y-%m-%d %H:%M:%S') - Free memory before maintenance: ${FREE_MEM_BEFORE}MB" >> "$LOG_FILE"

# 2. Stop the driver service first (graceful shutdown preserves session)
echo "$(date '+%Y-%m-%d %H:%M:%S') - Stopping whatsapp-driver service..." >> "$LOG_FILE"
sudo systemctl stop whatsapp-driver

# Wait for process to fully exit (TimeoutStopSec in service is 300s,
# but 15s is fine because the Node process handles SIGTERM quickly)
echo "Waiting for graceful shutdown..." >> "$LOG_FILE"
sleep 15

# 3. Check for zombie processes and kill if necessary
# This handles the case where the browser process got stuck
if pgrep -f "chromium" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Cleaning up stuck Chromium processes..." >> "$LOG_FILE"
    pkill -f "chromium"
    sleep 2
fi

if pgrep -f "server.js" > /dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Cleaning up stuck Node processes..." >> "$LOG_FILE"
    pkill -f "server.js"
    sleep 2
fi

# 4. Clean up ONLY safe temporary files (no session data!)
# Only remove crash dumps and screenshots, never session data.
rm -f "${PROJECT_DIR}/qr_screenshot.png" 2>/dev/null

# 5. Start the driver service
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting whatsapp-driver service..." >> "$LOG_FILE"
sudo systemctl start whatsapp-driver

# Wait for driver to initialize (RPi 3B+ can be slow)
sleep 90

# 6. Check if driver came back up
if systemctl is-active --quiet whatsapp-driver; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Driver restarted successfully" >> "$LOG_FILE"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ERROR: Driver failed to restart!" >> "$LOG_FILE"
fi

# 7. Log memory AFTER restart
FREE_MEM_AFTER=$(free -m | awk '/^Mem:/{print $4}')
echo "$(date '+%Y-%m-%d %H:%M:%S') - Free memory after maintenance: ${FREE_MEM_AFTER}MB (was ${FREE_MEM_BEFORE}MB)" >> "$LOG_FILE"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Daily maintenance complete" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
