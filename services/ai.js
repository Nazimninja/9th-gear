const { GoogleGenerativeAI } = require('@google/generative-ai');
const businessInfo = require('../config/businessInfo');
const { getLearningTips } = require('./learningEngine');
require('dotenv').config();

if (!process.env.GEMINI_API_KEY) {
    console.error('❌ CRITICAL: GEMINI_API_KEY is missing!');
} else {
    console.log('✅ Gemini API Key loaded. Model: gemini-2.5-flash');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function buildInventoryText() {
    if (!businessInfo.vehicles || businessInfo.vehicles.length === 0) {
        return '(No inventory data yet — if asked about specific cars, say you will check and send details shortly. Do NOT keep stalling on the same car repeatedly.)';
    }
    return businessInfo.vehicles.map(v =>
        `- ${v.model} (${v.year || ''}): ${v.price} | ${v.details} | More info: ${v.url}`
    ).join('\n');
}

async function getAIResponse(userId, messageBody, userState) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return "Just a moment, let me check that for you!";
        }

        // ── BUILD SYSTEM PROMPT ─────────────────────────────────
        // Fetch learning tips (cached in memory, refreshed every 2h)
        const learningTips = await getLearningTips();
        const learningSection = learningTips
            ? `\n━━━━━━━━━━━━━━━━━━━━━━━\nCOACHING TIPS FROM EXPERIENCE (learned from real past conversations — follow these):\n━━━━━━━━━━━━━━━━━━━━━━━\n${learningTips}\n`
            : '';

        // Check if bot has already spoken before in this conversation
        const hasPriorBotMessage = (userState.history || []).some(
            m => m.role === 'Nazim' && m.content && m.content.trim()
        );

        const systemPrompt = `${businessInfo.systemPrompt}${learningSection}
CURRENT INVENTORY (use ONLY this — do NOT make up cars):
${buildInventoryText()}

MEMORY RULES (read chat history before every reply):
- Do NOT repeat any question already asked.
- Do NOT reintroduce yourself if already done.
- Use the customer's name if known. Don't ask for it again.
- Remember their car preference and city — never ask twice.
${hasPriorBotMessage ? '\nCRITICAL: This is NOT the first message. You have ALREADY introduced yourself. Go straight into helping — no intro, no "Hey there, this is Nazim" etc.' : '\nThis IS the first message. Give a brief, warm intro and ask what they are looking for.'}
`;

        // ── BUILD CHAT HISTORY ──────────────────────────────────
        // Gemini needs strictly alternating user/model turns
        const rawHistory = (userState.history || []).filter(m => m.content && m.content.trim());

        const geminiHistory = [];
        for (const msg of rawHistory) {
            const role = msg.role === 'Nazim' ? 'model' : 'user';
            if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === role) {
                // Merge consecutive same-role turns
                geminiHistory[geminiHistory.length - 1].parts[0].text += '\n' + msg.content;
            } else {
                geminiHistory.push({ role, parts: [{ text: msg.content }] });
            }
        }

        // Must start with user turn — if history begins with a bot message,
        // prepend a synthetic user opener so context is NOT lost
        if (geminiHistory.length > 0 && geminiHistory[0].role !== 'user') {
            geminiHistory.unshift({ role: 'user', parts: [{ text: '(conversation started)' }] });
        }

        // Remove last user turn — we send it as the live message below
        if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === 'user') {
            geminiHistory.pop();
        }

        // ── SEND TO GEMINI 2.5 FLASH ────────────────────────────
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: systemPrompt,
        });

        const chat = model.startChat({
            history: geminiHistory,
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 500,
                topP: 0.95,
                topK: 40,
            },
        });

        // Retry on 429 / 503 — shorter delays since 2.5-flash has higher limits
        const retryDelays = [5000, 10000, 20000, 30000];
        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
            try {
                const result = await chat.sendMessage(messageBody);
                return result.response.text();
            } catch (error) {
                const msg = error.message || '';
                const is429 = msg.includes('429');
                const is503 = msg.includes('503');

                if ((is429 || is503) && attempt < retryDelays.length) {
                    const waitMs = is503 ? 3000 : retryDelays[attempt];
                    console.error(`Gemini ${is429 ? '429 Rate Limit' : '503 Overloaded'}. Waiting ${waitMs / 1000}s (retry ${attempt + 1}/${retryDelays.length})...`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    throw error;
                }
            }
        }

    } catch (error) {
        console.error('❌ Gemini Fatal Error:', error.message);
        // Throw so the caller (index.js) can handle the fallback with proper logging
        throw error;
    }
}

module.exports = { getAIResponse };
