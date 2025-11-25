import wa from '@open-wa/wa-automate';
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

let client = null;
let clientReady = false;

// Initialize WhatsApp client
async function initializeClient() {
  try {
    console.log('Initializing WhatsApp client...');
    client = await wa.create({
      sessionId: 'whatsapp_scheduler',
      sessionDataPath: './',
      headless: true,
      // Keep multiDevice false to match the saved session file format in this repo.
      multiDevice: false,
      // Use the system Chromium binary if available. If your environment has a different
      // path, update `executablePath` accordingly.
      useChrome: true,
      executablePath: '/usr/bin/chromium-browser',
      // Add common Linux-friendly Chromium launch args to avoid sandboxing issues.
      chromiumArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-zygote',
        '--single-process'
      ],
      qrTimeout: 0,
      authTimeout: 0,
      skipUpdateCheck: true,
      // Enable console logs from the browser for easier debugging if needed.
      logConsole: true
    });

    // Set up message listener
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

// Health check endpoint
app.get('/status', (req, res) => {
  res.json({ status: 'ok', ready: clientReady });
});

// Get all groups with name->JID mapping
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
        id: g.id,
        members: g.groupMetadata?.participants?.length || 0
      }));
    res.json({ status: 'ok', groups });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Open WhatsApp (client is already connected via open-wa)
app.post('/open_whatsapp', (req, res) => {
  if (!clientReady) {
    return res.status(500).json({ status: 'error', message: 'WhatsApp client not ready' });
  }
  res.json({ status: 'ok' });
});

// Send message
app.post('/send_message', async (req, res) => {
  if (!clientReady || !client) {
    return res.status(500).json({ status: 'error', message: 'WhatsApp client not ready' });
  }

  const { contact, message } = req.body;
  if (!contact || !message) {
    return res.status(400).json({ status: 'error', message: 'Missing contact or message' });
  }

  try {
    // Convert contact name to phone number format if needed
    const chatId = `${contact.replace(/[^\d]/g, '')}@c.us`;
    await client.sendText(chatId, message);
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Send poll
app.post('/send_poll', async (req, res) => {
  if (!clientReady || !client) {
    return res.status(500).json({ status: 'error', message: 'WhatsApp client not ready' });
  }

  const { contact, question, options } = req.body;
  if (!contact || !question || !options || options.length === 0) {
    return res.status(400).json({ status: 'error', message: 'Missing required fields' });
  }

  try {
    // Determine chat id: if caller provided an explicit JID (e.g. group id), use it
    const chatId = contact.includes('@') ? contact : `${contact.replace(/[^\d]/g, '')}@c.us`;

    // If this is a group chat id (ends with @g.us) we can send a native poll
    if (chatId.endsWith('@g.us')) {
      // sendPoll(to: GroupChatId, name: string, options: string[], quotedMsgId?: MessageId, allowMultiSelect?: boolean)
      await client.sendPoll(chatId, question, options);
      return res.json({ status: 'ok', method: 'poll' });
    }

    // For 1:1 chats, WhatsApp doesn't support poll UI; use buttons for up to 3 options
    if (options.length <= 3) {
      // Use the library-expected button shape: use `text` for the label where applicable.
      const buttons = options.map((opt, i) => ({ id: `opt${i + 1}`, text: opt }));
      // sendButtons(to, body, buttons, title?, footer?)
      await client.sendButtons(chatId, question, buttons, 'Poll', 'Reply by tapping a button');
      return res.json({ status: 'ok', method: 'buttons' });
    }

    // For more than 3 options, send a list message (user selects one item).
    // Use `rowId` for the row identifier which is commonly expected by list APIs.
    const rows = options.map((opt, i) => ({ rowId: `opt${i + 1}`, title: opt }));
    const sections = [{ title: 'Options', rows }];
    // sendListMessage(to, sections, title, description, actionText)
    await client.sendListMessage(chatId, sections, 'Poll', question, 'Choose an option');
    return res.json({ status: 'ok', method: 'list' });
  } catch (error) {
    console.error('Error sending poll:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Start server
const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Initialize client in the background, don't wait for it
  initializeClient().catch(err => {
    console.error('Failed to initialize client:', err);
  });
});
