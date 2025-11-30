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

const app = express();
app.use(bodyParser.json());

// Global client state
let client = null;           // WhatsApp client instance
let clientReady = false;     // Connection readiness flag

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
    client = await wa.create({
      sessionId: 'whatsapp_scheduler',      // Unique session identifier
      sessionDataPath: './',                 // Store session data in current directory
      headless: true,                        // Run browser without GUI (essential for Pi)
      multiDevice: true,                     // Support new multi-device WhatsApp
      useChrome: true,                       // Use Chromium instead of bundled Chromium
      executablePath: '/usr/bin/chromium-browser',  // System Chromium path (adjust for your OS)
      
      // Chromium launch arguments for stability on Linux/Raspberry Pi
      chromiumArgs: [
        '--no-sandbox',                      // Required for running as root or on Pi
        '--disable-setuid-sandbox',          // Additional sandbox bypass
        '--disable-dev-shm-usage',           // Use /tmp instead of /dev/shm (prevents crashes)
        '--disable-extensions',              // Don't load browser extensions
        '--no-zygote',                       // Disable zygote process (reduce memory)
        '--single-process'                   // Run in single process (lighter on Pi)
      ],
      
      qrTimeout: 0,                          // No timeout for QR scan (wait indefinitely)
      authTimeout: 0,                        // No timeout for authentication
      disableSpins: true,                    // Disable spinner animations in console
      skipUpdateCheck: true,                 // Don't check for library updates on startup
      logConsole: false                      // Don't log browser console messages
    });

    // Set up message listener for incoming messages (optional, for logging/debugging)
    client.onMessage(msg => {
      console.log(`Message received from ${msg.from}: ${msg.body}`);
    });

    clientReady = true;
    console.log('WhatsApp client initialized successfully!');
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
 * @returns {200} { status: 'ok', method: 'poll'|'buttons'|'list' }
 * @returns {400} { status: 'error', message: string } - missing fields
 * @returns {500} { status: 'error', message: string } - send failed
 */
app.post('/send_poll', async (req, res) => {
  if (!clientReady || !client) {
    return res.status(500).json({ status: 'error', message: 'WhatsApp client not ready' });
  }

  const { contact, question, options } = req.body;
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
      await client.sendPoll(chatId, question, options);
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
  console.log('  GET  /status       - Health check');
  console.log('  GET  /get_groups   - List all groups');
  console.log('  POST /send_message - Send text message');
  console.log('  POST /send_poll    - Send poll (native/buttons/list)');
  
  // Initialize WhatsApp client asynchronously (non-blocking)
  // First run will show QR code in console for phone scanning
  // Subsequent runs reuse session from whatsapp_scheduler.data.json
  initializeClient().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
    console.error('Server will continue running but won\'t be able to send messages');
  });
});
