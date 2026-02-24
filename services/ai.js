const { GoogleGenerativeAI } = require('@google/generative-ai');
const businessInfo = require('../config/businessInfo');
require('dotenv').config();

if (!process.env.GEMINI_API_KEY) {
    console.error("❌ CRITICAL: GEMINI_API_KEY is missing in Environment Variables!");
} else {
    console.log("✅ Gemini API Key found. Model initialized.");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Build inventory string for the system prompt
function buildInventoryText() {
    return businessInfo.vehicles.map(v =>
        `- ${v.model} (${v.year}): ${v.price} | ${v.details} | More info: ${v.url}`
    ).join('\n');
}

async function getAIResponse(userId, messageBody, userState) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return "Just a moment, checking that for you.";
        }

        // --- BUILD SYSTEM PROMPT ---
        const systemPrompt = `${businessInfo.systemPrompt}

CURRENT INVENTORY (33 cars — use ONLY this for information, do NOT hallucinate cars):
${buildInventoryText()}

IMPORTANT MEMORY RULES:
- The CONVERSATION HISTORY below shows everything already discussed.
- DO NOT repeat any question that has already been asked.
- DO NOT reintroduce yourself if "Nazim here" already appears in history.
- If the customer mentioned their name, use it.
- If they mentioned a car preference, remember it and do not ask again.
- If they mentioned their city, remember it and do not ask again.
`;

        // --- BUILD PROPER MULTI-TURN CHAT HISTORY ---
        // Convert WhatsApp history into Gemini's alternating user/model format.
        // Gemini requires strictly alternating turns: user, model, user, model...
        const rawHistory = userState.history || [];

        // Filter to only messages that have real content
        const filteredHistory = rawHistory.filter(msg => msg.content && msg.content.trim().length > 0);

        // Build alternating turns — merge consecutive same-role messages
        const geminiHistory = [];
        for (const msg of filteredHistory) {
            const role = msg.role === "Nazim" ? "model" : "user";
            // If last turn has same role, append to it (Gemini requires strict alternation)
            if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === role) {
                geminiHistory[geminiHistory.length - 1].parts[0].text += '\n' + msg.content;
            } else {
                geminiHistory.push({ role, parts: [{ text: msg.content }] });
            }
        }

        // Ensure history starts with a user turn (Gemini requirement)
        while (geminiHistory.length > 0 && geminiHistory[0].role !== 'user') {
            geminiHistory.shift();
        }

        // Remove the LAST turn if it's the current message (we'll send it as the live message)
        // The current user message should NOT be in history — it's sent separately
        if (geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === 'user') {
            geminiHistory.pop();
        }

        // --- START CHAT SESSION ---
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            systemInstruction: systemPrompt,
        });

        const chat = model.startChat({
            history: geminiHistory,
            generationConfig: {
                temperature: 0.95,    // High variety — no two replies should sound the same
                maxOutputTokens: 280, // Concise WhatsApp replies
                topP: 0.95,
                topK: 40,
            },
        });

        // --- SEND THE CURRENT MESSAGE ---
        // Retry with exponential backoff: 10s, 20s, 30s for 429 rate limits
        const retryDelays = [10000, 20000, 30000];
        let attempt = 0;
        while (attempt <= retryDelays.length) {
            try {
                const result = await chat.sendMessage(messageBody);
                const text = result.response.text();
                return text;
            } catch (error) {
                const errMsg = error.message || '';
                if (errMsg.includes('429')) {
                    if (attempt >= retryDelays.length) {
                        console.error(`Gemini Rate Limit exhausted after ${attempt} retries. Giving up.`);
                        throw error;
                    }
                    const waitMs = retryDelays[attempt];
                    console.error(`Gemini Rate Limit (429). Waiting ${waitMs / 1000}s before retry ${attempt + 1}/${retryDelays.length}...`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else if (errMsg.includes('503')) {
                    console.error(`Gemini Overloaded (503). Retrying in 5s...`);
                    await new Promise(r => setTimeout(r, 5000));
                } else {
                    console.error(`Gemini API Error:`, errMsg);
                    throw error;
                }
                attempt++;
            }
        }

    } catch (error) {
        console.error("❌ Gemini API Fatal Error:", error.message);
        // Human-sounding fallback — pick one randomly so even errors sound natural
        const fallbacks = [
            "Hey sorry, bit tied up right now. I'll get back to you in a minute!",
            "Sorry hold on, give me a sec 🙏",
            "My bad, just a moment — will reply shortly!",
            "Sorry, just stepped away — back in a bit!"
        ];
        return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
}

module.exports = { getAIResponse };
