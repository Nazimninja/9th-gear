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
} = require('./config/state');
const businessInfo = require('./config/businessInfo');
require('dotenv').config();

// ============================================================
// BOT START TIME — reject messages older than this (anti-duplicate)
// ============================================================
const BOT_START_TIME_SECONDS = Math.floor(Date.now() / 1000);
console.log(`[Boot] Bot started at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

// ============================================================
// DEDUP CACHE — in-memory only (Railway restarts clear it,
// which is correct — old messages should not be re-processed
// but the timestamp guard already handles that anyway)
// ============================================================
const processedMessageIds = new Set();

function isDuplicate(msgId) {
    if (processedMessageIds.has(msgId)) return true;
    processedMessageIds.add(msgId);
    // Keep last 1000 IDs in memory
    if (processedMessageIds.size > 1000) {
        const first = processedMessageIds.values().next().value;
        processedMessageIds.delete(first);
    }
    return false;
}

// ============================================================
// SERIAL MESSAGE QUEUE — ensures only ONE Gemini call at a time.
// Prevents 429 rate limits when multiple users message simultaneously.
// ============================================================
let messageQueue = Promise.resolve();
const GEMINI_CALL_INTERVAL_MS = 6000; // 10 RPM safe gap (1 per 6s)
let lastGeminiCallTime = 0;

function enqueueMessage(handler) {
    messageQueue = messageQueue
        .then(() => handler())
        .catch(err => console.error('[Queue] Handler error:', err.message));
}

async function waitForGeminiSlot() {
    const elapsed = Date.now() - lastGeminiCallTime;
    if (elapsed < GEMINI_CALL_INTERVAL_MS) {
        const wait = GEMINI_CALL_INTERVAL_MS - elapsed;
        console.log(`[Queue] Waiting ${Math.round(wait / 1000)}s for Gemini slot...`);
        await new Promise(r => setTimeout(r, wait));
    }
    lastGeminiCallTime = Date.now();
}

// ============================================================
// PHONE NUMBER HELPER
// ============================================================
function cleanPhone(rawId) {
    return rawId.replace(/@.*$/, '').replace(/\D/g, '');
}

async function getRealPhone(message) {
    try {
        const contact = await message.getContact();
        if (contact && contact.number) return contact.number.replace(/\D/g, '');
    } catch (e) {
        console.log('[Phone] getContact() failed, using fallback');
    }
    return cleanPhone(message.from);
}

// ============================================================
// CAR REQUIREMENT EXTRACTOR
// ============================================================
const CAR_BRANDS = [
    'bmw', 'mercedes', 'benz', 'audi', 'toyota', 'honda', 'hyundai', 'kia',
    'ford', 'tata', 'mahindra', 'maruti', 'suzuki', 'volkswagen', 'vw', 'volvo',
    'jeep', 'range rover', 'land rover', 'porsche', 'lexus', 'jaguar', 'skoda',
    'mini', 'mini cooper', 'evoque', 'defender', 'discovery', 'cayenne', 'macan',
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
    'tucson', 'santa fe', 'elantra',
    'octavia', 'superb', 'kodiaq',
    'endeavour', 'mustang', 'ecosport',
    'bolero', 'xuv', 'xuv500', 'xuv700', 'scorpio'
];

const BUYING_PHRASES = [
    'looking for', 'i want', 'i need', 'want to buy', 'planning to buy',
    'interested in', 'searching for', 'i am looking', 'im looking',
    'budget is', 'my budget', 'can i get'
];

function extractRequirement(body) {
    const lower = body.toLowerCase();
    const hasBrand = CAR_BRANDS.some(b => lower.includes(b));
    const hasIntent = BUYING_PHRASES.some(p => lower.includes(p));
    if ((hasBrand || hasIntent) && body.length > 3) {
        return body.length > 200 ? body.substring(0, 200) + '...' : body;
    }
    return null;
}

// ============================================================
// LOCATION EXTRACTOR
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
    'kr puram', 'hal', 'domlur', 'ejipura', 'jakkur', 'thanisandra', 'hennur',
    'nagawara', 'sahakara nagar', 'sanjaynagar', 'mathikere', 'peenya',
    'dasarahalli', 'bangalore', 'bengaluru', 'blr'
];
const KARNATAKA_CITIES = ['mysore', 'mysuru', 'mangalore', 'mangaluru', 'hubli', 'tumkur'];
const OTHER_CITIES = ['mumbai', 'delhi', 'chennai', 'hyderabad', 'pune', 'kolkata', 'gurgaon', 'noida'];

function toTitleCase(str) { return str.replace(/\b\w/g, c => c.toUpperCase()); }

function extractLocation(body) {
    const lower = body.toLowerCase();
    for (const a of BANGALORE_AREAS) { if (lower.includes(a)) return `Bangalore - ${toTitleCase(a)}`; }
    for (const c of KARNATAKA_CITIES) { if (lower.includes(c)) return toTitleCase(c) + ', Karnataka'; }
    for (const c of OTHER_CITIES) { if (lower.includes(c)) return toTitleCase(c); }
    return null;
}

// ============================================================
// SCRAPE INVENTORY ON STARTUP
// ============================================================
(async () => {
    try {
        const scrapedData = await scrapeBusinessData();
        if (scrapedData.vehicles.length > 0) {
            businessInfo.vehicles = scrapedData.vehicles;
            console.log(`[Scraper] Loaded ${scrapedData.vehicles.length} vehicles.`);
        }
    } catch (e) {
        console.error('[Scraper] Failed:', e.message);
    }
})();

// ============================================================
// HTTP SERVER — keep-alive + /qr endpoint
// ============================================================
const http = require('http');
const port = process.env.PORT || 8080;
let latestQR = null;

const server = http.createServer(async (req, res) => {
    if (req.url === '/qr') {
        if (!latestQR) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#fff">
<h2>✅ WhatsApp already connected!</h2><p>No QR needed. Bot is running.</p></body></html>`);
            return;
        }
        try {
            const qrDataUrl = await QRCode.toDataURL(latestQR, { width: 400, margin: 2 });
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html><html>
<head><title>Scan QR — 9th Gear</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#0d0d0d;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#fff}
h2{margin-bottom:8px}p{color:#aaa;font-size:.9rem;margin-bottom:24px}img{border-radius:16px}
.note{margin-top:20px;font-size:.8rem;color:#666}</style></head>
<body><h2>📱 Scan with WhatsApp</h2>
<p>Open WhatsApp → Linked Devices → Link a Device</p>
<img src="${qrDataUrl}" width="300" height="300"/>
<p class="note">QR expires in ~20s. Refreshes automatically.</p>
<script>setTimeout(()=>location.reload(),18000);</script></body></html>`);
        } catch (e) {
            res.writeHead(500);
            res.end('QR error: ' + e.message);
        }
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('9th Gear Bot is Running 🚀\nVisit /qr to scan WhatsApp QR\n');
});
server.listen(port, () => console.log(`[Server] Running on port ${port} — visit /qr for QR code`));

// ============================================================
// GLOBAL ERROR HANDLERS
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('[CRASH] Uncaught Exception:', err.message);
    // Exit so Railway auto-restarts cleanly with saved session
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH] Unhandled Rejection:', reason);
});

// ============================================================
// WHATSAPP CLIENT
// ============================================================
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/usr/src/app/.wwebjs_auth' }),
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
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--safebrowsing-disable-auto-update',
            '--js-flags=--max-old-space-size=256',
            '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ],
        bypassCSP: true
    }
});

client.on('qr', (qr) => {
    latestQR = qr;
    console.log('\n[QR] New QR generated — open /qr in your browser to scan');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    latestQR = null;
    console.log('✅ WhatsApp connected and ready!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Auth failure — exiting for Railway to restart:', msg);
    process.exit(1);
});

// ============================================================
// DISCONNECT HANDLER — exit cleanly so Railway restarts.
// LocalAuth saves session to disk, so on restart the bot
// reconnects WITHOUT needing a new QR scan.
// ============================================================
client.on('disconnected', (reason) => {
    console.warn(`⚠️ WhatsApp disconnected (${reason}). Exiting — Railway will restart.`);
    process.exit(1);
});

// ============================================================
// MESSAGE HANDLER
// ============================================================
client.on('message', async (message) => {
    // ── FAST FILTERS (outside queue, no cost) ──────────────
    if (message.isStatus) return;
    if (message.from.includes('@g.us')) return; // ignore groups
    if (message.fromMe) {
        // You replied manually → pause AI for this contact for 30min
        console.log(`[Handoff] Manual reply to ${message.to} — AI paused 30min`);
        setHandoff(message.to, 30 * 60 * 1000);
        return;
    }

    // Reject old messages (WhatsApp re-delivers on reconnect)
    if (message.timestamp < BOT_START_TIME_SECONDS) {
        console.log(`[TimeGuard] Skipping old message from ${message.from}`);
        return;
    }

    // Dedup — skip if already processed
    if (isDuplicate(message.id._serialized)) {
        console.log(`[Dedup] Skipping duplicate: ${message.id._serialized}`);
        return;
    }

    const body = message.body ? message.body.trim() : '';
    if (!body) return; // skip media-only messages

    const userId = message.from;

    // ── QUEUE: process one message at a time ───────────────
    enqueueMessage(async () => {
        if (isHandedOff(userId)) {
            console.log(`[Handoff] AI paused for ${userId}, skipping.`);
            return;
        }

        try {
            const phone = await getRealPhone(message);
            const name = message._data?.notifyName
                || message._data?.pushName
                || message.notifyName
                || 'Unknown';

            console.log(`📩 [${new Date().toLocaleTimeString('en-IN')}] ${name} (${phone}): ${body}`);

            const chat = await message.getChat();

            // Fetch chat history for context
            let history = [];
            try {
                const fetched = await chat.fetchMessages({ limit: 15 });
                history = fetched.map(m => ({
                    role: m.fromMe ? 'Nazim' : 'User',
                    content: m.body || ''
                })).filter(m => m.content.trim());
                // Ensure current message is at end
                if (!history.length || history[history.length - 1].content !== body) {
                    history.push({ role: 'User', content: body });
                }
            } catch (e) {
                history = [{ role: 'User', content: body }];
            }

            let userState = getOrInitState(userId);
            userState.history = history;

            // Log new lead to Sheets (first message only)
            if (!userState.hasLogged) {
                try {
                    await appendToSheet({
                        date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                        name, phone, requirement: '', location: '', status: 'New Lead'
                    });
                    userState.hasLogged = true;
                    updateState(userId, userState);
                    console.log(`[Sheets] ✅ Lead logged: ${name} (${phone})`);
                } catch (e) {
                    console.error('[Sheets] ❌ Lead log failed:', e.message);
                }
            }

            // Log car requirement when detected
            const req = extractRequirement(body);
            if (req && !userState.requirementLogged) {
                try {
                    await updateRequirement(phone, name, req);
                    userState.requirementLogged = true;
                    userState.vehicleInterest = req;
                    updateState(userId, userState);
                    console.log(`[Sheets] ✅ Requirement: "${req}"`);
                } catch (e) {
                    console.error('[Sheets] ❌ Requirement update failed:', e.message);
                }
            }

            // Log location when detected
            const loc = extractLocation(body);
            if (loc && !userState.locationLogged) {
                try {
                    await updateLocation(phone, loc);
                    userState.locationLogged = true;
                    userState.location = loc;
                    updateState(userId, userState);
                    console.log(`[Sheets] ✅ Location: "${loc}"`);
                } catch (e) {
                    console.error('[Sheets] ❌ Location update failed:', e.message);
                }
            }

            // Wait for Gemini rate limit slot
            await waitForGeminiSlot();

            // Get AI response
            const response = await getAIResponse(userId, body, userState);

            if (userState.step === 0) {
                userState.step = 1;
                updateState(userId, userState);
            }

            if (!response) return;

            // Human-like typing delay
            const len = response.length;
            const delayMs = len < 60
                ? 1500 + Math.random() * 1500
                : len < 150
                    ? 3000 + Math.random() * 2000
                    : 4000 + Math.random() * 2000;

            try { await chat.sendStateTyping(); } catch (_) { }
            await new Promise(r => setTimeout(r, delayMs));

            await client.sendMessage(userId, response);
            console.log(`[Sent] → ${name}: ${response.substring(0, 60)}...`);

        } catch (err) {
            const msg = err.message || '';
            console.error('❌ Message handler error:', msg);
            // TargetCloseError = Puppeteer browser crashed → exit so Railway restarts
            if (msg.includes('Target closed') || msg.includes('Session closed') || msg.includes('Protocol error')) {
                console.error('[CRASH] Puppeteer died — exiting for Railway to restart cleanly');
                process.exit(1);
            }
        }
    });
});

client.initialize();
