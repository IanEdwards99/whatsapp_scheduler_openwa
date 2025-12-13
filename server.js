/**
 * WhatsApp Driver Server
 * 
 * This Node.js server manages the WhatsApp Web connection using @open-wa/wa-automate
 * and exposes a simple HTTP API for sending messages and polls.
 * 
 * Architecture:
 * - Uses Puppeteer to control Chromium browser connected to WhatsApp Web
 * - Session persisted in whatsapp_scheduler.data.json (no repeated QR scans)
 * - Exposes REST API on port 5001 for Python scheduler to consume
 * - Handles group name→JID resolution via /get_groups endpoint
 * 
 * Port: 5001
 * Dependencies: @open-wa/wa-automate, express, body-parser
 */

import wa from '@open-wa/wa-automate';
import express from 'express';
import bodyParser from 'body-parser';
import QRCode from 'qrcode';
import fs from 'fs';

const app = express();
app.use(bodyParser.json());

// Global client state
let client = null;           // WhatsApp client instance
let clientReady = false;     // Connection readiness flag
let qrCodeData = null;       // Store QR code data for PNG export
let pageRef = null;          // Store page reference for screenshots

/**
 * Save QR code as PNG file
 * 
 * Converts base64 QR code data to PNG image file for headless deployments.
 * Enables scanning QR via browser (http://pi-ip:5001/qr_code.png) or SCP download
 * when running on Raspberry Pi without display.
 * 
 * @param {string} qrData - Base64 QR code data from open-wa (already an image)
 * @returns {Promise<void>}
 */
async function saveQRCodeAsPNG(qrData) {
  try {
    // QR data from open-wa is already a base64 encoded PNG image
    // Format: "data:image/png;base64,iVBORw0KGgo..."
    if (qrData.startsWith('data:image')) {
      // Extract the base64 part after the comma
      const base64Data = qrData.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync('qr_code.png', buffer);
      console.log('QR code saved as qr_code.png');
      console.log('Access it at: http://localhost:5001/qr_code.png');
    } else {
      // Fallback: try to generate QR from raw data
      await QRCode.toFile('qr_code.png', qrData, {
        width: 512,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      console.log('QR code saved as qr_code.png');
    }
  } catch (error) {
    console.error('Error saving QR code as PNG:', error);
  }
}

/**
 * Initialize WhatsApp Web client
 * 
 * Creates a persistent WhatsApp Web session using open-wa:
 * - First run: displays QR code in console for phone scanning
 * - Subsequent runs: rehydrates session from whatsapp_scheduler.data.json
 * - Configures Chromium with Linux-friendly flags (no-sandbox for Pi/Docker)
 * - Sets up message listener for incoming message logging
 * 
 * @returns {Promise<void>}
 */
async function initializeClient() {
  try {
    console.log('Initializing WhatsApp client...');
    console.log('Working directory:', process.cwd());
    
    let qrReceived = false;
    let screenshotInterval = null;
    
    // Use ev (event) mode to get page access before authentication completes
    wa.ev.on('qr.**', async (qrData, sessionId) => {
      console.log('🎯 QR EVENT RECEIVED!');
      qrCodeData = qrData;
      qrReceived = true;
      
      // Save QR as PNG
      await saveQRCodeAsPNG(qrData);
      console.log('✅ QR code saved!');
      console.log('   Access at: http://<your-ip>:5001/qr_code.png');
    });
    
    // Also listen for page events to take screenshots as fallback
    wa.ev.on('PAGE.**', async (page) => {
      console.log('📄 PAGE EVENT - Taking screenshot...');
      try {
        await page.screenshot({ path: 'qr_screenshot.png', fullPage: true });
        console.log('✅ Screenshot saved to qr_screenshot.png');
        console.log('   Access at: http://<your-ip>:5001/qr_screenshot.png');
      } catch (e) {
        console.log('Screenshot error:', e.message);
      }
    });
    
    // Create client with qrCallback as fallback
    client = await wa.create({
      sessionId: 'whatsapp_scheduler',
      sessionDataPath: './',
      headless: true,
      multiDevice: true,
      useChrome: true,
      executablePath: '/usr/bin/chromium-browser',
      
      qrRefreshS: 60,
      qrTimeout: 0,
      authTimeout: 0,
      disableSpins: true,
      skipUpdateCheck: true,
      logConsole: false,
      logQR: true,  // Enable QR logging to console
      killProcessOnBrowserClose: true,
      
      // Fallback QR callback in case ev.on doesn't fire
      qrCallback: async (qrData) => {
        console.log('📱 QR CALLBACK RECEIVED!');
        if (!qrReceived) {
          qrCodeData = qrData;
          await saveQRCodeAsPNG(qrData);
          console.log('✅ QR code saved via callback!');
          console.log('   Access at: http://<your-ip>:5001/qr_code.png');
        }
      },
      
      // Get page reference for screenshots
      onPageCreated: async (page) => {
        console.log('📄 PAGE CREATED - Starting screenshot timer...');
        // Take periodic screenshots until authenticated
        screenshotInterval = setInterval(async () => {
          if (clientReady) {
            clearInterval(screenshotInterval);
            return;
          }
          try {
            await page.screenshot({ path: 'qr_screenshot.png', fullPage: true });
            console.log('📸 Screenshot updated - Access at: http://<your-ip>:5001/qr_screenshot.png');
          } catch (e) {
            console.log('Screenshot error:', e.message);
          }
        }, 5000); // Every 5 seconds
      },
    });

    // Clear screenshot interval after authentication
    if (screenshotInterval) {
      clearInterval(screenshotInterval);
    }

    console.log('✅ Authentication successful!');

    client.onMessage(msg => {
      console.log(`Message received from ${msg.from}: ${msg.body}`);
    });

    clientReady = true;
    console.log('✅ WhatsApp client initialized successfully!');
    
    if (qrCodeData && fs.existsSync('qr_code.png')) {
      fs.unlinkSync('qr_code.png');
      console.log('QR code PNG deleted (authentication successful)');
      qrCodeData = null;
    }
  } catch (error) {
    console.error('Error initializing WhatsApp client:', error);
    clientReady = false;
  }
}

/**
 * GET /status
 * Health check endpoint
 * 
 * Returns driver status and readiness for accepting message/poll requests.
 * Used by scheduler to verify driver is initialized before sending.
 * 
 * @returns {200} { status: 'ok', ready: true/false }
 */
app.get('/status', (req, res) => {
  res.json({ status: 'ok', ready: clientReady });
});

/**
 * GET /qr_code.png
 * Serve QR code PNG for scanning
 * 
 * Serves the QR code image file for headless deployments.
 * Access via browser at http://pi-ip:5001/qr_code.png to scan with phone.
 * File is automatically deleted after successful authentication.
 * 
 * @returns {200} PNG image file
 * @returns {404} { status: 'error', message: string } - if no QR code available
 */
app.get('/qr_code.png', (req, res) => {
  if (fs.existsSync('qr_code.png')) {
    res.sendFile('qr_code.png', { root: '.' });
  } else {
    res.status(404).json({ 
      status: 'error', 
      message: 'QR code not available (either not generated yet or already authenticated)' 
    });
  }
});

/**
 * GET /qr_screenshot.png
 * Serve full page screenshot for debugging
 * 
 * Serves the full WhatsApp Web page screenshot (fallback if QR callback fails).
 * 
 * @returns {200} PNG image file
 * @returns {404} { status: 'error', message: string } - if screenshot not available
 */
app.get('/qr_screenshot.png', (req, res) => {
  if (fs.existsSync('qr_screenshot.png')) {
    res.sendFile('qr_screenshot.png', { root: '.' });
  } else {
    res.status(404).json({ 
      status: 'error', 
      message: 'Screenshot not available' 
    });
  }
});

/**
 * GET /get_groups
 * List all WhatsApp groups with name→JID mapping
 * 
 * Fetches all group chats and returns their names, JIDs, and member counts.
 * Used by scheduler for group name resolution (user types "Family" → resolves to JID).
 * 
 * @returns {200} { status: 'ok', groups: [{name, id, members}] }
 * @returns {500} { status: 'error', message: string } - if client not ready
 */
app.get('/get_groups', async (req, res) => {
  if (!clientReady || !client) {
    return res.status(500).json({ status: 'error', message: 'WhatsApp client not ready' });
  }

  try {
    const chats = await client.getAllChats();
    const groups = chats
      .filter(c => c.isGroup)
      .map(g => ({
        name: g.name,
        id: g.id,  // Group JID (e.g., 120363404652820092@g.us)
        members: g.groupMetadata?.participants?.length || 0
      }));
    res.json({ status: 'ok', groups });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * POST /open_whatsapp
 * Legacy endpoint for compatibility
 * 
 * Client is already connected via open-wa, so this just returns success.
 * Kept for backward compatibility with old scheduler versions.
 * 
 * @returns {200} { status: 'ok' }
 * @returns {500} { status: 'error', message: string } - if client not ready
 */
app.post('/open_whatsapp', (req, res) => {
  if (!clientReady) {
    return res.status(500).json({ status: 'error', message: 'WhatsApp client not ready' });
  }
  res.json({ status: 'ok' });
});

/**
 * POST /send_message
 * Send text message to contact or group
 * 
 * Sends a plain text message to the specified contact.
 * Contact can be phone number or JID (for groups).
 * 
 * @param {string} contact - Phone number (+1 555 123 4567) or JID (120363...@g.us)
 * @param {string} message - Text message content
 * @returns {200} { status: 'ok' }
 * @returns {400} { status: 'error', message: string } - missing fields
 * @returns {500} { status: 'error', message: string } - send failed
 */
app.post('/send_message', async (req, res) => {
  if (!clientReady || !client) {
    return res.status(500).json({ status: 'error', message: 'WhatsApp client not ready' });
  }

  const { contact, message } = req.body;
  if (!contact || !message) {
    return res.status(400).json({ status: 'error', message: 'Missing contact or message' });
  }

  try {
    // Convert contact to WhatsApp chat ID format
    // If already a JID (contains @), use as-is; otherwise format as phone number
    const chatId = contact.includes('@') 
      ? contact 
      : `${contact.replace(/[^\d]/g, '')}@c.us`;
    
    await client.sendText(chatId, message);
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * POST /send_poll
 * Send poll with automatic UI selection
 * 
 * Intelligently sends polls based on chat type and option count:
 * - Groups (@g.us): Native WhatsApp poll UI (interactive, multi-tap)
 * - Private chats with ≤3 options: Interactive button message
 * - Private chats with >3 options: List selection message
 * 
 * This approach works around WhatsApp's limitation that native polls
 * only work in group chats.
 * 
 * @param {string} contact - Phone number, group name, or JID
 * @param {string} question - Poll question text
 * @param {string[]} options - Array of poll options
 * @param {boolean} [allowMultiSelect=false] - Allow selecting multiple options in polls
 * @returns {200} { status: 'ok', method: 'poll'|'buttons'|'list' }
 * @returns {400} { status: 'error', message: string } - missing fields
 * @returns {500} { status: 'error', message: string } - send failed
 */
app.post('/send_poll', async (req, res) => {
  if (!clientReady || !client) {
    return res.status(500).json({ status: 'error', message: 'WhatsApp client not ready' });
  }

  const { contact, question, options, allowMultiSelect = false } = req.body;
  if (!contact || !question || !options || options.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Missing required fields' });
  }

  try {
    // Determine chat ID: if contact contains @, it's already a JID; otherwise format as phone
    const chatId = contact.includes('@') 
      ? contact 
      : `${contact.replace(/[^\d]/g, '')}@c.us`;

    // STRATEGY 1: Native poll for groups
    // Group JIDs end with @g.us (e.g., 120363404652820092@g.us)
    if (chatId.endsWith('@g.us')) {
      // sendPoll(to: GroupChatId, name: string, options: string[], quotedMsgId?: MessageId, allowMultiSelect?: boolean)
      await client.sendPoll(chatId, question, options, undefined, allowMultiSelect);
      return res.json({ status: 'ok', method: 'poll' });
    }

    // STRATEGY 2: Interactive buttons for ≤3 options in private chats
    // WhatsApp buttons limited to 3 buttons maximum
    if (options.length <= 3) {
      // Button format: { id: string, text: string }
      const buttons = options.map((opt, i) => ({ 
        id: `opt${i + 1}`,  // Unique button ID
        text: opt           // Button label
      }));
      // sendButtons(to, body, buttons, title?, footer?)
      await client.sendButtons(chatId, question, buttons, 'Poll', 'Reply by tapping a button');
      return res.json({ status: 'ok', method: 'buttons' });
    }

    // STRATEGY 3: List message for >3 options in private chats
    // List messages allow selection from dropdown menu
    const rows = options.map((opt, i) => ({ 
      rowId: `opt${i + 1}`,   // Unique row identifier
      title: opt              // Option text
    }));
    const sections = [{ title: 'Options', rows }];
    // sendListMessage(to, sections, title, description, actionText)
    await client.sendListMessage(chatId, sections, 'Poll', question, 'Choose an option');
    return res.json({ status: 'ok', method: 'list' });
    
  } catch (error) {
    console.error('Error sending poll:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Start Express server and initialize WhatsApp client
const PORT = 5001;
app.listen(PORT, () => {
  console.log(`WhatsApp Driver API server running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /status            - Health check');
  console.log('  GET  /qr_code.png       - QR code PNG (for headless scanning)');
  console.log('  GET  /qr_screenshot.png - Full page screenshot (fallback)');
  console.log('  GET  /get_groups        - List all groups');
  console.log('  POST /send_message      - Send text message');
  console.log('  POST /send_poll         - Send poll (native/buttons/list)');
  
  // Initialize WhatsApp client asynchronously (non-blocking)
  // First run will show QR code in console for phone scanning
  // Subsequent runs reuse session from whatsapp_scheduler.data.json
  initializeClient().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
    console.error('Server will continue running but won\'t be able to send messages');
  });
});
