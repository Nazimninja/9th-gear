const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { getAIResponse } = require('./services/ai');
const { appendToSheet } = require('./services/sheets');
const { scrapeBusinessData } = require('./services/scraper');
const {
    getOrInitState,
    updateState,
    isHandedOff,
    setHandoff,
    resetHandoff
} = require('./config/state');
const businessInfo = require('./config/businessInfo');
require('dotenv').config();

// Initialize Data on Startup
(async () => {
    const scrapedData = await scrapeBusinessData();
    if (scrapedData.vehicles.length > 0) {
        businessInfo.vehicles = scrapedData.vehicles;
        console.log("Updated businessInfo with live vehicle data.");
    }
})();

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

// Generate QR Code
client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp AI Agent is ready!');
});

// Message Handling
client.on('message', async (message) => {
    // Ignore messages from status updates or groups (optional)
    if (message.isStatus || message.from.includes('@g.us')) return;

    const userId = message.from;
    const body = message.body.trim();

    // 1. Check for Human Handoff (Host replies)
    if (message.fromMe) {
        // If the business owner replies, pause AI for 30 minutes
        console.log(`Host replied to ${message.to}. Pausing AI.`);
        setHandoff(message.to, 30 * 60 * 1000);
        return;
    }

    // 2. Check if AI should be paused
    if (isHandedOff(userId)) {
        console.log(`AI paused for ${userId}. Ignoring message.`);
        return;
    }

    // 3. Process User Message
    try {
        console.log(`Received message from ${userId}: ${body}`);

        // Retrieve/Init User State
        let userState = getOrInitState(userId);

        // Add User Message to History
        userState.history.push({ role: "User", content: body });
        if (userState.history.length > 10) userState.history.shift(); // Keep last 10

        let response;

        // -- AI Logic --
        // We pass the whole state + history to the AI.
        // We still use 'step' tracking just for logging data (Sheets), but we let the AI handle the conversation flow.

        response = await getAIResponse(userId, body, userState);

        // Capture Location & Qualify Lead
        // The Prompt now enforces asking for Location FIRST.
        // So the first real user response (Step 0 -> 1) is likely the location.
        if (userState.step === 0) {
            userState.step = 1;
            userState.location = body;

            // CHECK LOCATION QUALIFICATION
            const karnatakaKeywords = ['bangalore', 'bengaluru', 'karnataka', 'mysore', 'mangalore', 'whitefield', 'indiranagar', 'koramangala', 'hsr', 'jayanagar', 'jp nagar', 'sadashivanagar', 'yes', 'blr'];
            const isQualified = karnatakaKeywords.some(loc => body.toLowerCase().includes(loc));

            if (isQualified) {
                try {
                    console.log(`[Main] Qualified Location (${body}). Logging to Sheets...`);
                    await appendToSheet({
                        date: new Date().toISOString(),
                        name: message._data.notifyName || "Unknown",
                        phone: userId.replace('@c.us', ''),
                        vehicle: "Pending (Asking)",
                        location: body,
                        status: "Qualified Lead"
                    });
                    console.log("[Main] Successfully logged QUALIFIED lead.");
                } catch (e) {
                    console.error("[Main] Sheet Logging Failed:", e.message);
                }
            } else {
                console.log(`[Main] User location (${body}) not in Karnataka list. NOT logging to Sheets.`);
            }
            updateState(userId, userState);
        } else if (userState.step === 1) {
            // Step 1 -> 2: They are giving Car Requirement
            userState.step = 2;
            userState.vehicleInterest = body;
            updateState(userId, userState);
        }

        // Send Response
        if (response) {
            await client.sendMessage(userId, response);
            // Add AI Message to History
            userState.history.push({ role: "Nazim", content: response });
            if (userState.history.length > 10) userState.history.shift();
        }

    } catch (error) {
        console.error('Error handling message:', error);
    }
});

client.initialize();
