const { GoogleGenerativeAI } = require('@google/generative-ai');
const businessInfo = require('../config/businessInfo');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
// Verified Available Model via HTTP Check: gemini-2.0-flash
const model = process.env.GEMINI_API_KEY ? genAI.getGenerativeModel({ model: "gemini-2.0-flash" }) : null;

if (!process.env.GEMINI_API_KEY) {
    console.error("❌ CRITICAL: GEMINI_API_KEY is missing in Environment Variables!");
} else {
    console.log("✅ Gemini API Key found. Model initialized.");
}

async function getAIResponse(userId, messageBody, userState) {
    try {
        // Dynamic Inventory
        const vehicleList = businessInfo.vehicles.map(v =>
            `- ${v.model} (${v.year}): ${v.price}, ${v.details}, Link: ${v.url}`
        ).join('\n');

        // Format History
        const chatHistory = userState.history.map(msg => `${msg.role}: ${msg.content}`).join('\n');

        const systemInstruction = `${businessInfo.systemPrompt}

        🧠 SOFT SKILLS & ADAPTABILITY:
        - **Mirroring:** If the user writes short messages, you write short messages. If they differ, match their energy.
        - **Variety:** Never use the exact same phrase twice in a row (e.g., don't always say "Let me check").
        - **Empathy:** If they say "Price is high", validate it ("I understand, premium cars do hold value...").

        INVENTORY:
        ${vehicleList}

        CONVERSATION HISTORY:
        ${chatHistory}
        
        Recent User Message: "${messageBody}"
        `;

        // Context is already in the system prompt. We don't need to force "Tasks" anymore.
        // This allows the natural conversation flow defined in businessInfo.js to take over.

        // Configure for more creativity (Less Robotic)
        const generationConfig = {
            temperature: 0.7,
            maxOutputTokens: 150, // Keep it punchy
        };

        let retries = 3;
        while (retries > 0) {
            try {
                if (!model) throw new Error("Gemini Model not initialized (Check API Key)");

                const result = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: systemInstruction }] }],
                    generationConfig: generationConfig
                });
                const response = await result.response;
                return response.text();
            } catch (error) {
                const mapError = (e) => {
                    if (e.message.includes('429')) return "Rate Limit";
                    if (e.message.includes('Quota')) return "Quota Exceeded";
                    if (e.message.includes('503')) return "Service Unavailable (Overloaded)";
                    return e.message;
                };

                console.error(`Gemini API Error (Attempt ${4 - retries}):`, mapError(error));

                if (retries === 1) throw error;
                retries--;
                const delay = error.message.includes('429') ? 4000 * (4 - retries) : 2000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

    } catch (error) {
        console.error("❌ Gemini API Fatal Error:", error.message, error.stack);
        return "Just a moment, checking that for you.";
    }
}

module.exports = { getAIResponse };
