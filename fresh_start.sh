#!/bin/bash
# Fresh start - clear WhatsApp session data and restart services
#
# Use this script when:
# - QR code is not being generated (session data exists but is invalid)
# - You want to re-authenticate with a different WhatsApp account
# - Session is corrupted or authentication is stuck

echo "=== Fresh Start - Clearing WhatsApp Session ==="
echo ""

# Stop all running services first
echo "Stopping all services..."

# Try to stop systemd services (if they exist and are active)
if systemctl is-active --quiet whatsapp-driver.service 2>/dev/null; then
    echo "Stopping systemd services (timeout 10s)..."
    sudo timeout 10 systemctl stop whatsapp-flask.service 2>/dev/null || true
    sudo timeout 10 systemctl stop whatsapp-scheduler.service 2>/dev/null || true
    sudo timeout 10 systemctl stop whatsapp-driver.service 2>/dev/null || true
    sudo timeout 10 systemctl stop whatsapp-maintenance.service 2>/dev/null || true
    sudo timeout 10 systemctl stop whatsapp-maintenance.timer 2>/dev/null || true
    
    # If still running, force kill
    if systemctl is-active --quiet whatsapp-driver.service 2>/dev/null; then
        echo "Force killing driver service..."
        sudo systemctl kill whatsapp-driver.service 2>/dev/null || true
    fi
fi

# Kill any manually started processes and Chromium
pkill -f "node server.js" 2>/dev/null || true
pkill -f "background_scheduler.py" 2>/dev/null || true
pkill -f "app.py" 2>/dev/null || true
pkill -f chromium 2>/dev/null || true
sleep 2

# Remove session data and QR code
echo "Clearing WhatsApp session data..."
rm -f whatsapp_scheduler.data.json
rm -f qr_code.png
rm -f qr_screenshot.png
echo "Session data cleared"
echo ""

# Always clear browser cache for a true fresh start
echo "Clearing ALL internal browser data (cache/cookies)..."
if [ -d "_IGNORE_whatsapp_scheduler" ]; then
    rm -rf _IGNORE_whatsapp_scheduler/
    echo "Browser cache cleared"
fi

echo ""
echo "Fresh start complete! You can now run ./start_all.sh"
echo "A new QR code will be generated at http://<pi-ip>:5001/qr_code.png"
