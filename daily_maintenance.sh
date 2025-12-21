#!/bin/bash
# Daily maintenance script for WhatsApp Scheduler
# 
# This script:
# 1. Safely restarts the driver service to free memory/resources
# 2. Runs at a time when no messages are typically scheduled (e.g., 4 AM)
#
# Installation:
#   chmod +x daily_maintenance.sh
#   sudo crontab -e
#   Add: 0 4 * * * /home/iedwards/development/whatsapp_scheduler_openwa/daily_maintenance.sh

LOG_FILE="/home/iedwards/development/whatsapp_scheduler_openwa/logs/maintenance.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting daily maintenance" >> "$LOG_FILE"

# 1. Stop the driver service first
echo "$(date '+%Y-%m-%d %H:%M:%S') - Stopping whatsapp-driver service..." >> "$LOG_FILE"
sudo systemctl stop whatsapp-driver

# Wait for process to fully exit
echo "Waiting for graceful shutdown..." >> "$LOG_FILE"
sleep 15

# 2. Check for zombie processes and kill if necessary
# This helps if the browser process got stuck
if pgrep -f "chromium" > /dev/null; then
    echo "Cleaning up stuck Chromium processes..." >> "$LOG_FILE"
    pkill -f "chromium"
fi

if pgrep -f "server.js" > /dev/null; then
    echo "Cleaning up stuck Node processes..." >> "$LOG_FILE"
    pkill -f "server.js"
fi

# 3. (Optional) Only delete crash dumps or temp files if absolutely necessary
# We avoid touching Cache/Default directories to prevent re-authentication issues.
# Only clearing minimal temp files if they exist.

# 4. Start the driver service
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting whatsapp-driver service..." >> "$LOG_FILE"
sudo systemctl start whatsapp-driver

# Wait for driver to initialize (RPi 3B+ can be slow)
sleep 90

# 5. Check if driver came back up
if systemctl is-active --quiet whatsapp-driver; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Driver restarted successfully" >> "$LOG_FILE"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ERROR: Driver failed to restart!" >> "$LOG_FILE"
fi

# 6. Log memory status
FREE_MEM=$(free -m | awk '/^Mem:/{print $4}')
echo "$(date '+%Y-%m-%d %H:%M:%S') - Free memory after maintenance: ${FREE_MEM}MB" >> "$LOG_FILE"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Daily maintenance complete" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
