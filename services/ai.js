const { GoogleGenerativeAI } = require('@google/generative-ai');
const businessInfo = require('../config/businessInfo');
require('dotenv').config();

if (!process.env.GEMINI_API_KEY) {
    console.error('❌ CRITICAL: GEMINI_API_KEY is missing!');
} else {
    console.log('✅ Gemini API Key loaded. Model: gemini-1.5-flash');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function buildInventoryText() {
    if (!businessInfo.vehicles || businessInfo.vehicles.length === 0) {
        return '(Inventory loading — tell customer you will check and confirm)';
    }
    return businessInfo.vehicles.map(v =>
        `- ${v.model} (${v.year}): ${v.price} | ${v.details} | More info: ${v.url}`
    ).join('\n');
}

async function getAIResponse(userId, messageBody, userState) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return "Just a moment, let me check that for you!";
        }

        // ── BUILD SYSTEM PROMPT ─────────────────────────────────
        const systemPrompt = `${businessInfo.systemPrompt}

CURRENT INVENTORY (use ONLY this — do NOT make up cars):
${buildInventoryText()}

MEMORY RULES (read chat history before every reply):
- Do NOT repeat any question already asked.
- Do NOT reintroduce yourself if already done.
- Use the customer's name if known. Don't ask for it again.
- Remember their car preference and city — never ask twice.
`;

        // ── BUILD CHAT HISTORY ──────────────────────────────────
        // Gemini needs strictly alternating user/model turns
        const rawHistory = (userState.history || []).filter(m => m.content && m.content.trim());

        const geminiHistory = [];
        for (const msg of rawHistory) {
            const role = msg.role === 'Nazim' ? 'model' : 'user';
            if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === role) {
                // Merge consecutive same-role turns (Gemini doesn't allow them back-to-back)
                geminiHistory[geminiHistory.length - 1].parts[0].text += '\n' + msg.content;
            } else {
                geminiHistory.push({ role, parts: [{ text: msg.content }] });
            }
        }

        // Must start with user turn
        while (geminiHistory.length > 0 && geminiHistory[0].role !== 'user') {
            geminiHistory.shift();
        }

        // Remove last user turn — we send it as the live message below
        if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === 'user') {
            geminiHistory.pop();
        }

        // ── SEND TO GEMINI ──────────────────────────────────────
        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: systemPrompt,
        });

        const chat = model.startChat({
            history: geminiHistory,
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 300,
                topP: 0.95,
                topK: 40,
            },
        });

        // Retry on 429 / 503 with exponential backoff
        const retryDelays = [10000, 20000, 30000, 45000, 60000, 90000];
        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
            try {
                const result = await chat.sendMessage(messageBody);
                return result.response.text();
            } catch (error) {
                const msg = error.message || '';
                const is429 = msg.includes('429');
                const is503 = msg.includes('503');

                if ((is429 || is503) && attempt < retryDelays.length) {
                    const waitMs = is503 ? 5000 : retryDelays[attempt];
                    console.error(`Gemini ${is429 ? '429 Rate Limit' : '503 Overloaded'}. Waiting ${waitMs / 1000}s (retry ${attempt + 1}/${retryDelays.length})...`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    // Non-retryable error or retries exhausted
                    throw error;
                }
            }
        }

    } catch (error) {
        console.error('❌ Gemini Fatal Error:', error.message);
        // Natural-sounding fallbacks for when AI is unavailable
        const fallbacks = [
            "Hey sorry, give me just a minute 🙏",
            "My bad, bit tied up — will reply shortly!",
            "Sorry, just stepped away — back in a sec!",
            "One moment, checking on that for you!"
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
}

module.exports = { getAIResponse };
