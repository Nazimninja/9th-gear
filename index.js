const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
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
// BOT START TIME — Only process messages received AFTER this moment.
// This is the PRIMARY fix for duplicate messages on reconnect.
// WhatsApp delivers old messages again when the bot restarts —
// we simply reject anything older than our startup timestamp.
// ============================================================
const BOT_START_TIME_SECONDS = Math.floor(Date.now() / 1000);
console.log(`[Boot] Bot started at timestamp: ${BOT_START_TIME_SECONDS}`);

// ============================================================
// PERSISTED DEDUP CACHE — Survives restarts (saved to disk)
// Secondary safety net: even if a message has the same timestamp,
// we won't process the same message ID twice.
// ============================================================
const DEDUP_FILE = path.join(__dirname, 'data', 'processed_ids.json');
let processedMessageIds = new Set();

function loadDedupCache() {
    try {
        if (fs.existsSync(DEDUP_FILE)) {
            const data = JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf8'));
            processedMessageIds = new Set(data);
            console.log(`[Dedup] Loaded ${processedMessageIds.size} processed message IDs from disk.`);
        }
    } catch (e) {
        console.error('[Dedup] Failed to load cache:', e.message);
    }
}

function saveDedupCache() {
    try {
        const arr = Array.from(processedMessageIds).slice(-500); // Keep latest 500
        fs.writeFileSync(DEDUP_FILE, JSON.stringify(arr));
    } catch (e) {
        console.error('[Dedup] Failed to save cache:', e.message);
    }
}

function isDuplicate(msgId) {
    if (processedMessageIds.has(msgId)) return true;
    processedMessageIds.add(msgId);
    // Keep max 500 entries
    if (processedMessageIds.size > 500) {
        const firstKey = processedMessageIds.values().next().value;
        processedMessageIds.delete(firstKey);
    }
    saveDedupCache(); // Persist immediately
    return false;
}

loadDedupCache();

// ============================================================
// SERIAL MESSAGE QUEUE — only ONE Gemini call runs at a time.
// All incoming messages are chained onto this promise so even
// if 10 people message simultaneously, they process one-by-one.
// This is the REAL fix for 429 rate limit errors.
// ============================================================
let messageQueue = Promise.resolve();
const MIN_GEMINI_INTERVAL_MS = 7000; // safe for 15 RPM (1 per 6s + buffer)
let lastGeminiCallTime = 0;

function enqueueMessage(handler) {
    messageQueue = messageQueue.then(() => handler()).catch(() => { });
}

async function waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - lastGeminiCallTime;
    if (elapsed < MIN_GEMINI_INTERVAL_MS) {
        const wait = MIN_GEMINI_INTERVAL_MS - elapsed;
        console.log(`[Queue] Waiting ${wait}ms before next Gemini call...`);
        await new Promise(r => setTimeout(r, wait));
    }
    lastGeminiCallTime = Date.now();
}

// ============================================================
// CLEAN PHONE — use contact's real number (avoids @lid garbage)
// ============================================================
function cleanPhone(rawId) {
    // Fallback: strip @c.us / @lid etc. and any non-digits
    return rawId.replace(/@.*$/, '').replace(/\D/g, '');
}

async function getRealPhone(message) {
    try {
        const contact = await message.getContact();
        // contact.number is the actual phone number WhatsApp gave us
        if (contact && contact.number) {
            return contact.number.replace(/\D/g, ''); // digits only
        }
    } catch (e) {
        console.log('[Phone] getContact() failed, falling back:', e.message);
    }
    // Fallback to parsing the userId
    return cleanPhone(message.from);
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
    'price', 'lakh', 'lakhs', 'looking for', 'need a', 'want a', 'interested in',
    '3 series', '5 series', '7 series', 'e class', 'c class', 's class', 'a4', 'a6',
    '320d', '520d', 'sport line', 'sport'
];

// ─── SPECIFIC CAR BRANDS / MODELS (must have at least one of these)
const CAR_BRANDS = [
    'bmw', 'mercedes', 'benz', 'audi', 'toyota', 'honda', 'hyundai', 'kia',
    'ford', 'tata', 'mahindra', 'maruti', 'suzuki', 'volkswagen', 'vw', 'volvo',
    'jeep', 'range rover', 'land rover', 'porsche', 'lexus', 'jaguar', 'skoda',
    'evoque', 'defender', 'discovery', 'freelander', 'cayenne', 'macan',
    'gle', 'glc', 'gla', 'glb', 'e class', 'c class', 's class', 'a class',
    'e200', 'e220', 'c200', 'c220', 'c300',
    '3 series', '5 series', '7 series', 'x1', 'x3', 'x5', 'x7',
    '320d', '520d', '530d', '730d', '118i', '120i',
    'a4', 'a6', 'a8', 'q3', 'q5', 'q7', 'q8',
    'xc60', 'xc90', 'xc40',
    'fortuner', 'innova', 'crysta', 'legender',
    'creta', 'nexon', 'harrier', 'safari', 'thar',
    'city', 'civic', 'accord', 'cr-v',
    'celerio', 'baleno', 'brezza', 'ertiga', 'swift',
    'tucson', 'santa fe', 'veloster', 'elantra',
    'octavia', 'superb', 'kodiaq',
    'endeavour', 'mustang', 'ecosport',
    'bolero', 'xuv', 'xuv500', 'xuv700', 'scorpio'
];

// ─── BUYING INTENT PHRASES (signals they actively want to buy)
const BUYING_PHRASES = [
    'looking for', 'i want', 'i need', 'want to buy', 'planning to buy',
    'interested in', 'searching for', 'i am looking', 'im looking',
    'budget is', 'my budget', 'can i get'
];

function extractRequirement(body) {
    const lower = body.toLowerCase();

    // Must mention a specific brand/model
    const hasBrand = CAR_BRANDS.some(brand => lower.includes(brand));
    // OR must have a strong buying intent
    const hasIntent = BUYING_PHRASES.some(phrase => lower.includes(phrase));

    if ((hasBrand || hasIntent) && body.length > 3) {
        // Clean up: limit to 200 chars
        return body.length > 200 ? body.substring(0, 200) + '...' : body;
    }
    return null;
}

// ============================================================
// EXTRACT LOCATION FROM MESSAGE
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

// --- RAILWAY HTTP SERVER — serves /qr so you can scan from your phone ---
const http = require('http');
const port = process.env.PORT || 8080;

let latestQR = null; // stored whenever 'qr' event fires

const server = http.createServer(async (req, res) => {
    if (req.url === '/qr') {
        if (!latestQR) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#fff">
<h2>✅ WhatsApp already connected — no QR needed!</h2>
<p>If the bot just restarted, refresh in a few seconds.</p>
</body></html>`);
            return;
        }
        try {
            const qrImageDataUrl = await QRCode.toDataURL(latestQR, { width: 400, margin: 2 });
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Scan QR — 9th Gear Bot</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin:0; background:#0d0d0d; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; font-family:sans-serif; color:#fff; }
    h2 { font-size:1.4rem; margin-bottom:8px; }
    p  { color:#aaa; font-size:0.9rem; margin-bottom:24px; }
    img { border-radius:16px; box-shadow:0 0 40px #00e87644; }
    .note { margin-top:20px; font-size:0.8rem; color:#666; }
  </style>
</head>
<body>
  <h2>📱 Scan with WhatsApp</h2>
  <p>Open WhatsApp → Linked Devices → Link a Device</p>
  <img src="${qrImageDataUrl}" width="300" height="300" />
  <p class="note">QR expires in ~20 seconds. Refresh if it doesn't scan.</p>
  <script>setTimeout(()=>location.reload(), 20000);</script>
</body>
</html>`);
        } catch (e) {
            res.writeHead(500);
            res.end('QR generation failed: ' + e.message);
        }
        return;
    }
    // Default keep-alive
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Nazim (9th Gear AI) is Running! 🚀\nVisit /qr to scan the WhatsApp QR code.\n');
});
server.listen(port, () => {
    console.log(`[Server] HTTP server on port ${port} — visit /qr to scan QR code`);
});

// --- GLOBAL ERROR HANDLERS ---
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR (Uncaught):', err);
});
process.on('unhandledRejection', (reason) => {
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

// QR Code
client.on('qr', (qr) => {
    latestQR = qr; // Store for the /qr web endpoint
    console.log('\n\n=============================================');
    console.log('   QR READY — open your Railway public URL + /qr to scan');
    console.log('=============================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\n=============================================\n');
});

client.on('ready', () => {
    latestQR = null; // Clear QR once connected
    console.log(`✅ WhatsApp AI Agent is ready! Ignoring messages older than ${BOT_START_TIME_SECONDS}`);
});

// ============================================================
// MESSAGE HANDLER
// ============================================================
client.on('message', async (message) => {
    // Ignore groups and status — fast check, outside queue
    if (message.isStatus || message.from.includes('@g.us')) return;

    // Fast pre-checks outside the queue
    const msgTimestamp = message.timestamp;
    if (msgTimestamp < BOT_START_TIME_SECONDS) {
        console.log(`[TimeGuard] Skipping old message (ts: ${msgTimestamp} < bot start: ${BOT_START_TIME_SECONDS})`);
        return;
    }
    if (isDuplicate(message.id._serialized)) {
        console.log(`[Dedup] Skipping already-processed: ${message.id._serialized}`);
        return;
    }

    // Push ALL actual processing into the serial queue
    // Only ONE message is processed at a time — prevents parallel 429s
    enqueueMessage(async () => {

        if (isDuplicate(message.id._serialized)) {
            console.log(`[Dedup] Skipping already-processed: ${message.id._serialized}`);
            return;
        }

        const userId = message.from;
        const body = message.body ? message.body.trim() : '';
        if (!body) return; // Skip empty/media-only messages

        // 1. Human Handoff
        if (message.fromMe) {
            console.log(`Host replied to ${message.to}. Pausing AI.`);
            setHandoff(message.to, 30 * 60 * 1000);
            return;
        }

        // 2. Check if AI is paused
        if (isHandedOff(userId)) {
            console.log(`AI paused for ${userId}. Ignoring.`);
            return;
        }

        try {
            // ✅ Get REAL phone number from WhatsApp contact (not the @lid internal hash)
            const phone = await getRealPhone(message);
            const name = message._data?.notifyName
                || message._data?.pushName
                || message.notifyName
                || 'Unknown';

            console.log(`📩 [${new Date().toLocaleTimeString('en-IN')}] From ${name} (${phone}): ${body}`);

            const chat = await message.getChat();

            // Fetch real chat history
            let history = [];
            try {
                const fetched = await chat.fetchMessages({ limit: 15 });
                history = fetched.map(msg => ({
                    role: msg.fromMe ? "Nazim" : "User",
                    content: msg.body
                }));
                if (!history.length || history[history.length - 1].content !== body) {
                    history.push({ role: "User", content: body });
                }
            } catch (e) {
                history = [{ role: "User", content: body }];
            }

            let userState = getOrInitState(userId);
            userState.history = history;

            // =========================================================
            // LOG FIRST MESSAGE — Name + Phone immediately
            // =========================================================
            if (!userState.hasLogged) {
                try {
                    await appendToSheet({
                        date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                        name,
                        phone,
                        requirement: '',
                        location: '',
                        status: 'New Lead'
                    });
                    userState.hasLogged = true;
                    updateState(userId, userState);
                    console.log(`[Sheets] ✅ New lead logged: ${name} (${phone})`);
                } catch (e) {
                    console.error('[Sheets] ❌ Failed to log new lead:', e.message);
                }
            }

            // =========================================================
            // CAPTURE REQUIREMENT
            // =========================================================
            const detectedRequirement = extractRequirement(body);
            if (detectedRequirement && !userState.requirementLogged) {
                try {
                    await updateRequirement(phone, name, detectedRequirement);
                    userState.requirementLogged = true;
                    userState.vehicleInterest = detectedRequirement;
                    updateState(userId, userState);
                    console.log(`[Sheets] ✅ Requirement: "${detectedRequirement}"`);
                } catch (e) {
                    console.error('[Sheets] ❌ Failed to update requirement:', e.message);
                }
            }

            // =========================================================
            // CAPTURE LOCATION
            // =========================================================
            const detectedLocation = extractLocation(body);
            if (detectedLocation && !userState.locationLogged) {
                try {
                    await updateLocation(phone, detectedLocation);
                    userState.locationLogged = true;
                    userState.location = detectedLocation;
                    updateState(userId, userState);
                    console.log(`[Sheets] ✅ Location: "${detectedLocation}"`);
                } catch (e) {
                    console.error('[Sheets] ❌ Failed to update location:', e.message);
                }
            }

            // Rate limit before Gemini
            await waitForRateLimit();

            const response = await getAIResponse(userId, body, userState);

            // Step management
            if (userState.step === 0) {
                userState.step = 1;
                updateState(userId, userState);
            }

            // Human-like delay
            let delayMs = 2000;
            if (response) {
                const len = response.length;
                if (len < 50) delayMs = Math.floor(Math.random() * 2000) + 2000;
                else if (len < 150) delayMs = Math.floor(Math.random() * 3000) + 4000;
                else delayMs = Math.floor(Math.random() * 4000) + 6000;
            }

            try { await chat.sendStateTyping(); } catch (e) { }

            console.log(`[Delay] Waiting ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));

            if (response) {
                await client.sendMessage(userId, response);
            }

        } catch (error) {
            console.error('❌ Error handling message:', error);
        }
    }); // end enqueueMessage
}); // end client.on('message')

client.initialize();
