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
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
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

        // --- GLOBAL LOCATION MONITOR ---
        // Check EVERY message for location keywords until we have logged them.

        if (!userState.hasLogged) {
            const karnatakaKeywords = ['bangalore', 'bengaluru', 'karnataka', 'mysore', 'mangalore', 'whitefield', 'indiranagar', 'koramangala', 'hsr', 'jayanagar', 'jp nagar', 'sadashivanagar', 'yes', 'blr'];
            const isQualified = karnatakaKeywords.some(loc => body.toLowerCase().includes(loc));

            // Log ALL leads, but mark status differently
            // We assume if they are replying to us, they are interested.
            // But we try to be smart: Only log if it looks like a location OR if we are in Step 1 (Location Phase).

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
                    userState.location = body;
                    userState.step = 2; // Move to Car Enquiry
                    updateState(userId, userState);

                } catch (e) {
                    console.error("[Main] Sheet Logging Failed:", e.message);
                }
            }
        }

        // --- STEP MANAGEMENT (For AI Context) ---
        if (userState.step === 0) {
            userState.step = 1; // Moved from Init -> Asking Location
            updateState(userId, userState);
        } else if (userState.step === 1 && userState.hasLogged) {
            userState.step = 2;
            updateState(userId, userState);
        } else if (userState.step === 2) {
            userState.vehicleInterest = body;
            updateState(userId, userState);
        }

        // --- HUMAN-LIKE DELAY LOGIC ---
        // Calculate delay based on response type to simulate thinking/typing.

        const chat = await message.getChat();
        let delayMs = 2000; // Default min

        // 1. Analyze Response Complexity
        if (response) {
            const length = response.length;
            const hasLink = response.includes('http');
            const isPrice = response.includes('₹') || response.toLowerCase().includes('price') || response.toLowerCase().includes('lakh');

            // Base typing speed: ~50ms per character (adjust for realism)
            // Short (hi): 2-4s
            // Medium (details): 5-8s
            // Long (links/price): 8-12s+

            if (length < 50) {
                delayMs = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000); // 2-4s
            } else if (length < 150) {
                delayMs = Math.floor(Math.random() * (8000 - 5000 + 1) + 5000); // 5-8s
            } else {
                delayMs = Math.floor(Math.random() * (12000 - 8000 + 1) + 8000); // 8-12s
            }

            // Special "Thinking" Pause for Price/Visit Intent (The "Trust Builder")
            // Playbook Rule: 10-15s for sensitive topics
            if (hasLink || isPrice) {
                // Ensure total is between 10-15s
                const currentMax = delayMs;
                const needed = 10000 - currentMax;
                if (needed > 0) delayMs += needed + Math.floor(Math.random() * 5000);
            }
        }

        // 2. Send "Typing..." Indicator
        try {
            await chat.sendStateTyping();
        } catch (e) { } // Ignore if fails

        // 3. Wait for the calculated delay
        console.log(`[Human Delay] Waiting ${delayMs}ms before sending...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));

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
