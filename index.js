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

// --- RAILWAY KEEP-ALIVE SERVER ---
// Railway requires the app to listen on a port, or it kills it.
const http = require('http');
const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Nazim (9th Gear AI) is Running! 🚀\n');
});
server.listen(port, () => {
    console.log(`[Server] Keep-alive server listening on port ${port}`);
});


// --- GLOBAL ERROR HANDLERS (Prevent Crash) ---
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR (Uncaught):', err);
    // Keep alive if possible, or exit gracefully
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL ERROR (Unhandled Rejection):', reason);
});

// Initialize WhatsApp Client
// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-features=site-per-process',
            '--no-default-browser-check',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-notifications',
            '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ],
        bypassCSP: true
    }
});

// Generate QR Code
client.on('qr', (qr) => {
    console.log('\n\n=============================================');
    console.log('   SCAN THIS QR CODE WITH WHATSAPP NOW:  ');
    console.log('=============================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\n=============================================');
    console.log('IF QR IS BLURRY — paste this at qr-code-generator.com:');
    console.log(qr);
    console.log('=============================================\n');
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
        const chat = await message.getChat();

        // --- FETCH REAL HISTORY (Memory Fix) ---
        // Instead of relying on a JSON file that gets wiped, we ask WhatsApp for the chat history.
        // This ensures the bot KNOWS if it already said "Hi, Nazim here".

        let history = [];
        try {
            const fetchedMessages = await chat.fetchMessages({ limit: 15 });
            history = fetchedMessages.map(msg => ({
                role: msg.fromMe ? "Nazim" : "User",
                content: msg.body
            }));
            // Append current message if not yet in history (it usually is, but just in case)
            if (history.length === 0 || history[history.length - 1].content !== body) {
                history.push({ role: "User", content: body });
            }
        } catch (histErr) {
            console.error("Failed to fetch chat history:", histErr);
            history = [{ role: "User", content: body }]; // Fallback
        }

        // Retrieve/Init User State (Just for Sheet Logging/Phase tracking, NOT for history)
        let userState = getOrInitState(userId);

        let response;
        // -- AI Logic --
        // Pass the REAL history to the AI.
        // We temporarily attach history to userState just for the function call, or specific arg
        userState.history = history;

        response = await getAIResponse(userId, body, userState);

        // --- GLOBAL LOCATION MONITOR ---
        if (!userState.hasLogged) {
            const karnatakaKeywords = ['bangalore', 'bengaluru', 'karnataka', 'mysore', 'mangalore', 'whitefield', 'indiranagar', 'koramangala', 'hsr', 'jayanagar', 'jp nagar', 'sadashivanagar', 'yes', 'blr'];
            const isQualified = karnatakaKeywords.some(loc => body.toLowerCase().includes(loc));
            const isLocationPhase = (userState.step === 1);
            const hasLocationKeyword = isQualified || ['mumbai', 'delhi', 'chennai', 'hyderabad', 'pune', 'city', 'town'].some(w => body.toLowerCase().includes(w));

            if (isQualified || isLocationPhase || hasLocationKeyword) {
                try {
                    const status = isQualified ? "Qualified Lead" : "Lead (d)";
                    console.log(`[Main] Lead Detected (${status}): "${body}". Logging to Sheets...`);

                    await appendToSheet({
                        date: new Date().toISOString(),
                        name: message._data.notifyName || "Unknown",
                        phone: userId.replace('@c.us', ''),
                        vehicle: userState.vehicleInterest || "Pending",
                        location: body,
                        status: status
                    });
                    console.log("[Main] Successfully logged lead.");

                    userState.hasLogged = true;
                    userState.step = 2;
                    updateState(userId, userState);

                } catch (e) {
                    console.error("❌ [Main] Sheet Logging Failed:", e.message);
                }
            }
        }

        // --- STEP MANAGEMENT ---
        if (userState.step === 0) {
            userState.step = 1;
            updateState(userId, userState);
        } else if (userState.step === 1 && userState.hasLogged) {
            userState.step = 2;
            updateState(userId, userState);
        }

        // --- HUMAN-LIKE DELAY LOGIC ---
        let delayMs = 2000;
        if (response) {
            const length = response.length;
            if (length < 50) delayMs = Math.floor(Math.random() * 2000) + 2000; // 2-4s
            else if (length < 150) delayMs = Math.floor(Math.random() * 3000) + 4000; // 4-7s
            else delayMs = Math.floor(Math.random() * 4000) + 6000; // 6-10s
        }

        // Send "Typing..." Indicator
        try { await chat.sendStateTyping(); } catch (e) { }

        console.log(`[Human Delay] Waiting ${delayMs}ms before sending...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // Send Response
        if (response) {
            await client.sendMessage(userId, response);
        }

    } catch (error) {
        console.error('Error handling message:', error);
    }
});

client.initialize();
