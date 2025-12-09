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
if systemctl is-active --quiet whatsapp-driver.service; then
    echo "Stopping systemd services..."
    sudo systemctl stop whatsapp-driver.service
    sudo systemctl stop whatsapp-scheduler.service
    sudo systemctl stop whatsapp-flask.service
fi

# Kill any manually started processes
pkill -f "node server.js"
pkill -f "background_scheduler.py"
pkill -f "app.py"
sleep 2

# Remove session data and QR code
echo "Clearing WhatsApp session data..."
rm -f whatsapp_scheduler.data.json
rm -f qr_code.png
echo "Session data cleared"
echo ""

# Optionally clear browser cache (more thorough reset)
read -p "Clear browser cache too? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo "Clearing browser cache..."
    rm -rf _IGNORE_whatsapp_scheduler/
    echo "Browser cache cleared"
fi

echo ""
echo "Fresh start complete! You can now run ./start_all.sh"
echo "A new QR code will be generated at http://localhost:5001/qr_code.png"
