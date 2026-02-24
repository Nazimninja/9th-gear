const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { getAIResponse } = require('./services/ai');
const { appendToSheet, updateRequirement, updateLocation } = require('./services/sheets');
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

// ============================================================
// DEDUPLICATION CACHE — Prevents same message being processed twice
// ============================================================
const processedMessageIds = new Set();
const DEDUP_CACHE_MAX = 500;

function isDuplicate(msgId) {
    if (processedMessageIds.has(msgId)) return true;
    processedMessageIds.add(msgId);
    if (processedMessageIds.size > DEDUP_CACHE_MAX) {
        const firstKey = processedMessageIds.values().next().value;
        processedMessageIds.delete(firstKey);
    }
    return false;
}

// ============================================================
// RATE LIMITER — 3s minimum gap between Gemini calls
// ============================================================
let lastGeminiCallTime = 0;
const MIN_GEMINI_INTERVAL_MS = 3000;

async function waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - lastGeminiCallTime;
    if (elapsed < MIN_GEMINI_INTERVAL_MS) {
        const wait = MIN_GEMINI_INTERVAL_MS - elapsed;
        console.log(`[RateLimit] Waiting ${wait}ms before Gemini call...`);
        await new Promise(r => setTimeout(r, wait));
    }
    lastGeminiCallTime = Date.now();
}

// ============================================================
// CLEAN PHONE NUMBER
// Strips @c.us / @lid / @s.whatsapp.net — returns digits only
// ============================================================
function cleanPhone(rawId) {
    return rawId.replace(/@.*$/, '').replace(/\D/g, '');
}

// ============================================================
// EXTRACT CAR REQUIREMENT FROM MESSAGE
// ============================================================
const CAR_KEYWORDS = [
    'car', 'suv', 'sedan', 'hatchback', 'luxury', 'bmw', 'mercedes', 'benz',
    'audi', 'toyota', 'honda', 'hyundai', 'kia', 'ford', 'tata', 'mahindra',
    'maruti', 'suzuki', 'volkswagen', 'volvo', 'jeep', 'range rover', 'gle',
    'glc', 'xc90', 'fortuner', 'innova', 'creta', 'nexon', 'ertiga', 'swift',
    'pre-owned', 'preowned', 'pre owned', 'used', 'second hand', 'budget',
    'price', 'lakh', 'lakhs', 'looking for', 'need a', 'want a', 'interested in'
];

function extractRequirement(body) {
    const lower = body.toLowerCase();
    const isCarRelated = CAR_KEYWORDS.some(kw => lower.includes(kw));
    if (isCarRelated && body.length > 4) {
        return body.length > 200 ? body.substring(0, 200) + '...' : body;
    }
    return null;
}

// ============================================================
// EXTRACT LOCATION FROM MESSAGE
// Detects Bangalore localities, Karnataka cities, or other cities
// ============================================================
const BANGALORE_AREAS = [
    'jp nagar', 'hsr layout', 'hsr', 'koramangala', 'indiranagar', 'whitefield',
    'electronic city', 'marathahalli', 'bellandur', 'sarjapur', 'bannerghatta',
    'jayanagar', 'btm layout', 'btm', 'wilson garden', 'shivajinagar', 'mg road',
    'brigade road', 'lavelle road', 'ub city', 'sadashivanagar', 'malleshwaram',
    'yeshwanthpur', 'rajajinagar', 'vijayanagar', 'hebbal', 'yelahanka',
    'devanahalli', 'kengeri', 'mysore road', 'tumkur road', 'cunningham road',
    'richmond town', 'langford town', 'cox town', 'frazer town', 'banaswadi',
    'hbr layout', 'kalyan nagar', 'rt nagar', 'ramamurthy nagar', 'mahadevapura',
    'kr puram', 'tin factory', 'old airport road', 'hal', 'domlur', 'ejipura',
    'jakkur', 'thanisandra', 'hennur', 'nagawara', 'sahakara nagar', 'sanjaynagar',
    'mathikere', 'peenya', 'dasarahalli', 'chikkabanavara', 'bangalore', 'bengaluru', 'blr'
];

const KARNATAKA_CITIES = [
    'mysore', 'mysuru', 'mangalore', 'mangaluru', 'hubli', 'dharwad',
    'belgaum', 'bellary', 'tumkur', 'hassan', 'mandya', 'shimoga', 'davangere'
];

const OTHER_CITIES = [
    'mumbai', 'delhi', 'chennai', 'hyderabad', 'pune', 'kolkata', 'ahmedabad',
    'surat', 'jaipur', 'lucknow', 'noida', 'gurgaon'
];

function extractLocation(body) {
    const lower = body.toLowerCase();
    for (const area of BANGALORE_AREAS) {
        if (lower.includes(area)) return `Bangalore - ${toTitleCase(area)}`;
    }
    for (const city of KARNATAKA_CITIES) {
        if (lower.includes(city)) return toTitleCase(city) + ', Karnataka';
    }
    for (const city of OTHER_CITIES) {
        if (lower.includes(city)) return toTitleCase(city);
    }
    return null;
}

function toTitleCase(str) {
    return str.replace(/\b\w/g, c => c.toUpperCase());
}

// Initialize Data on Startup
(async () => {
    const scrapedData = await scrapeBusinessData();
    if (scrapedData.vehicles.length > 0) {
        businessInfo.vehicles = scrapedData.vehicles;
        console.log("Updated businessInfo with live vehicle data.");
    }
})();

// --- RAILWAY KEEP-ALIVE SERVER ---
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
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL ERROR (Unhandled Rejection):', reason);
});

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
    // Ignore group messages and status updates
    if (message.isStatus || message.from.includes('@g.us')) return;

    // ✅ DEDUPLICATION: Skip already-processed messages
    if (isDuplicate(message.id._serialized)) {
        console.log(`[Dedup] Skipping already-processed message: ${message.id._serialized}`);
        return;
    }

    const userId = message.from;
    const body = message.body ? message.body.trim() : '';

    // 1. Check for Human Handoff (Host replies)
    if (message.fromMe) {
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
        // --- EXTRACT CLEAN INFO ---
        const phone = cleanPhone(userId);
        // Try multiple sources for name (WhatsApp sometimes uses different fields)
        const name = message._data?.notifyName
            || message._data?.pushName
            || message.notifyName
            || 'Unknown';

        console.log(`Received from ${name} (${phone}): ${body}`);

        const chat = await message.getChat();

        // --- FETCH REAL HISTORY ---
        let history = [];
        try {
            const fetchedMessages = await chat.fetchMessages({ limit: 15 });
            history = fetchedMessages.map(msg => ({
                role: msg.fromMe ? "Nazim" : "User",
                content: msg.body
            }));
            if (history.length === 0 || history[history.length - 1].content !== body) {
                history.push({ role: "User", content: body });
            }
        } catch (histErr) {
            console.error("Failed to fetch chat history:", histErr);
            history = [{ role: "User", content: body }];
        }

        // Retrieve/Init User State
        let userState = getOrInitState(userId);
        userState.history = history;

        // =========================================================
        // ✅ LOG ON FIRST MESSAGE — Capture Name + Phone immediately
        // =========================================================
        if (!userState.hasLogged) {
            try {
                console.log(`[Sheets] New customer! Logging ${name} (${phone}) to sheet...`);
                await appendToSheet({
                    date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                    name: name,
                    phone: phone,
                    requirement: 'New Enquiry',
                    location: '',
                    status: 'New Lead'
                });
                userState.hasLogged = true;
                userState.sheetRowPhone = phone;
                updateState(userId, userState);
                console.log(`[Sheets] ✅ Logged new customer: ${name} (${phone})`);
            } catch (e) {
                console.error("❌ [Sheets] Failed to log new customer:", e.message);
            }
        }

        // =========================================================
        // ✅ CAPTURE REQUIREMENT — Update when customer mentions car need
        // =========================================================
        const detectedRequirement = extractRequirement(body);
        if (detectedRequirement && !userState.requirementLogged) {
            try {
                console.log(`[Sheets] Car requirement detected: "${detectedRequirement}". Updating sheet...`);
                await updateRequirement(phone, name, detectedRequirement);
                userState.requirementLogged = true;
                userState.vehicleInterest = detectedRequirement;
                updateState(userId, userState);
                console.log(`[Sheets] ✅ Requirement updated for ${phone}`);
            } catch (e) {
                console.error("❌ [Sheets] Failed to update requirement:", e.message);
            }
        }

        // =========================================================
        // ✅ CAPTURE LOCATION — Detect from message and update sheet
        // =========================================================
        const detectedLocation = extractLocation(body);
        if (detectedLocation && !userState.locationLogged) {
            try {
                console.log(`[Sheets] Location detected: "${detectedLocation}". Updating sheet...`);
                await updateLocation(phone, detectedLocation);
                userState.locationLogged = true;
                userState.location = detectedLocation;
                updateState(userId, userState);
                console.log(`[Sheets] ✅ Location updated for ${phone}: ${detectedLocation}`);
            } catch (e) {
                console.error("❌ [Sheets] Failed to update location:", e.message);
            }
        }

        // ✅ RATE LIMIT: Wait before calling Gemini
        await waitForRateLimit();

        let response;
        response = await getAIResponse(userId, body, userState);

        // --- STEP MANAGEMENT ---
        if (userState.step === 0) {
            userState.step = 1;
            updateState(userId, userState);
        }

        // --- HUMAN-LIKE DELAY LOGIC ---
        let delayMs = 2000;
        if (response) {
            const length = response.length;
            if (length < 50) delayMs = Math.floor(Math.random() * 2000) + 2000;
            else if (length < 150) delayMs = Math.floor(Math.random() * 3000) + 4000;
            else delayMs = Math.floor(Math.random() * 4000) + 6000;
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
