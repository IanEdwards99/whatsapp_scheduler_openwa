#!/bin/bash
# Daily maintenance script for WhatsApp Scheduler
# 
# This script:
# 1. Clears Chromium cache to free memory
# 2. Restarts the driver service for a clean state
# 3. Runs at a time when no messages are typically scheduled (e.g., 4 AM)
#
# Installation:
#   chmod +x daily_maintenance.sh
#   sudo crontab -e
#   Add: 0 4 * * * /home/iedwards/development/whatsapp_scheduler_openwa/daily_maintenance.sh
#
# Or install via systemd timer (see systemd/whatsapp-maintenance.timer)

LOG_FILE="/home/iedwards/development/whatsapp_scheduler_openwa/logs/maintenance.log"
DATA_DIR="/home/iedwards/development/whatsapp_scheduler_openwa/_IGNORE_whatsapp_scheduler"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting daily maintenance" >> "$LOG_FILE"

# 1. Clear Chromium cache (but NOT session/authentication data!)
# IMPORTANT: We preserve:
#   - Default/Cookies (WhatsApp session)
#   - Default/Local Storage (session data)  
#   - Default/IndexedDB (WhatsApp data)
#   - Default/Session Storage
#   - whatsapp_scheduler.data.json (wa-automate session)
echo "$(date '+%Y-%m-%d %H:%M:%S') - Clearing Chromium cache (preserving session)..." >> "$LOG_FILE"

# Only clear non-essential cache directories
CACHE_DIRS=(
    "$DATA_DIR/Default/Code Cache"
    "$DATA_DIR/Default/GPUCache"
    "$DATA_DIR/ShaderCache"
    "$DATA_DIR/GrShaderCache"
    "$DATA_DIR/GraphiteDawnCache"
)

for dir in "${CACHE_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        rm -rf "$dir"/*
        echo "  Cleared: $dir" >> "$LOG_FILE"
    fi
done

# 2. Restart the driver service
echo "$(date '+%Y-%m-%d %H:%M:%S') - Restarting whatsapp-driver service..." >> "$LOG_FILE"
sudo systemctl restart whatsapp-driver

# Wait for driver to initialize
sleep 60

# 3. Check if driver came back up
if systemctl is-active --quiet whatsapp-driver; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Driver restarted successfully" >> "$LOG_FILE"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ERROR: Driver failed to restart!" >> "$LOG_FILE"
fi

# 4. Log memory status
FREE_MEM=$(free -m | awk '/^Mem:/{print $4}')
echo "$(date '+%Y-%m-%d %H:%M:%S') - Free memory after maintenance: ${FREE_MEM}MB" >> "$LOG_FILE"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Daily maintenance complete" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
