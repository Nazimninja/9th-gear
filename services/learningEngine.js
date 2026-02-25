/**
 * Learning Engine — makes the bot smarter over time.
 *
 * Flow:
 *  1. After each conversation, logConversation() saves a summary to Google Sheets (ConvoLog tab).
 *  2. Every 2 hours, runLearningCycle() reads recent logs, asks Gemini for coaching tips,
 *     and saves those tips back to Sheets (Learning tab).
 *  3. getLearningTips() returns the latest tips (cached in memory).
 *     These are injected into the AI system prompt so every reply benefits.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
    appendConversationLog,
    appendLearningTip,
    getConversationLogs,
    getLearningTipsFromSheet,
} = require('./sheets');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ─── In-memory cache for tips (refreshed when learning cycle runs) ───────────
let cachedTips = [];
let lastTipLoad = 0;
const TIP_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

// ─── How many recent conversations to analyse per cycle ──────────────────────
const MAX_CONVOS_TO_ANALYSE = 30;

// ─── Minimum conversations needed before first learning cycle ────────────────
const MIN_CONVOS_FOR_LEARNING = 3;

/**
 * Log a completed conversation to the ConvoLog sheet tab.
 * Called from index.js after conversation activity (after a reply is sent).
 *
 * @param {string} userId
 * @param {string} name
 * @param {string} phone
 * @param {Array}  history  - Array of { role, content }
 * @param {string} outcome  - 'Engaged' | 'Handoff' | 'Lead Captured' | 'Qualified' | 'Dropped'
 */
async function logConversation(userId, name, phone, history, outcome) {
    try {
        // Build a brief summary: last 6 messages max (to keep it readable in Sheets)
        const recent = history.slice(-6);
        const summary = recent
            .map(m => `${m.role === 'Nazim' ? 'Bot' : 'Customer'}: ${m.content.substring(0, 120)}`)
            .join(' | ');

        await appendConversationLog({
            date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            name,
            phone,
            summary,
            outcome,
        });
    } catch (err) {
        console.error('[Learning] logConversation error:', err.message);
    }
}

/**
 * Main learning cycle — called every 2 hours.
 * Reads recent conversation logs, sends to Gemini for analysis,
 * saves new coaching tips to the Learning sheet tab.
 */
async function runLearningCycle() {
    console.log('[Learning] 🧠 Starting learning cycle...');
    try {
        // 1. Fetch recent conversation logs from Sheets
        const logs = await getConversationLogs(MAX_CONVOS_TO_ANALYSE);

        if (!logs || logs.length < MIN_CONVOS_FOR_LEARNING) {
            console.log(`[Learning] Not enough conversations yet (${logs?.length || 0}/${MIN_CONVOS_FOR_LEARNING}). Skipping.`);
            return;
        }

        // 2. Format logs for Gemini
        const logsText = logs.map((row, i) =>
            `Conversation ${i + 1} (${row.date}):\n` +
            `Customer: ${row.name} | Outcome: ${row.outcome}\n` +
            `${row.summary}`
        ).join('\n\n---\n\n');

        // 3. Ask Gemini to analyse and extract actionable tips
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const analysisPrompt = `You are a sales coach for 9th Gear — a luxury pre-owned car showroom in Bangalore.

Below are recent WhatsApp sales conversations between the AI sales agent "Nazim" and potential customers.

Analyse these conversations and extract 5-8 specific, actionable coaching tips that will help Nazim:
- Convert more leads (get them to book a visit or share their contact)
- Handle common objections better
- Avoid conversation drop-offs
- Use language patterns that worked well

Write each tip as a single clear sentence starting with an action verb.
Focus ONLY on things you can observe from the actual conversations below.
Do NOT give generic sales advice — only patterns you actually see.

Format: Return ONLY the tips, one per line, no numbering, no headers.

RECENT CONVERSATIONS:
${logsText}`;

        const result = await model.generateContent(analysisPrompt);
        const tipsText = result.response.text().trim();

        if (!tipsText) {
            console.log('[Learning] Gemini returned empty tips. Skipping save.');
            return;
        }

        // 4. Parse tips (one per line) and save each to the Learning sheet
        const tips = tipsText.split('\n').map(t => t.trim()).filter(t => t.length > 10);
        const date = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        for (const tip of tips) {
            await appendLearningTip({ date, tip });
        }

        console.log(`[Learning] ✅ ${tips.length} new tips saved to Sheets.`);

        // 5. Refresh the in-memory cache
        await refreshTipCache();

    } catch (err) {
        console.error('[Learning] runLearningCycle error:', err.message);
    }
}

/**
 * Refresh the in-memory tip cache from Google Sheets.
 */
async function refreshTipCache() {
    try {
        const tips = await getLearningTipsFromSheet();
        if (tips && tips.length > 0) {
            // Keep only the latest 15 tips (most recent learnings)
            cachedTips = tips.slice(-15);
            lastTipLoad = Date.now();
            console.log(`[Learning] 📚 Cache refreshed — ${cachedTips.length} tips active.`);
        }
    } catch (err) {
        console.error('[Learning] refreshTipCache error:', err.message);
    }
}

/**
 * Returns current learning tips for injection into the system prompt.
 * Refreshes cache if stale (> 2 hours).
 *
 * @returns {string} Formatted tips section, or '' if none available.
 */
async function getLearningTips() {
    try {
        // Refresh if cache is empty or stale
        if (cachedTips.length === 0 || Date.now() - lastTipLoad > TIP_CACHE_TTL) {
            await refreshTipCache();
        }
        if (cachedTips.length === 0) return '';

        return cachedTips.map(t => `- ${t}`).join('\n');
    } catch (err) {
        console.error('[Learning] getLearningTips error:', err.message);
        return '';
    }
}

/**
 * Start the periodic learning cycle (call once on bot startup).
 * Runs every 2 hours.
 */
function startLearningScheduler() {
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    // Load existing tips from Sheets on startup (don't wait)
    refreshTipCache().catch(() => { });

    // Run first learning cycle after 2 hours
    setTimeout(async () => {
        await runLearningCycle();
        // Then repeat every 2 hours
        setInterval(runLearningCycle, TWO_HOURS);
    }, TWO_HOURS);

    console.log('[Learning] 🧠 Scheduler started — first cycle in 2 hours.');
}

module.exports = { logConversation, getLearningTips, startLearningScheduler };
