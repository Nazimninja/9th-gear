const { GoogleGenerativeAI } = require('@google/generative-ai');
const businessInfo = require('../config/businessInfo');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = process.env.GEMINI_API_KEY ? genAI.getGenerativeModel({ model: "gemini-1.5-flash" }) : null;

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

        INVENTORY:
        ${vehicleList}

        CONVERSATION HISTORY:
        ${chatHistory}
        
        Recent User Message: "${messageBody}"
        `;

        let prompt = systemInstruction;

        // Context is already in the system prompt. We don't need to force "Tasks" anymore.
        // This allows the natural conversation flow defined in businessInfo.js to take over.

        let retries = 3;
        while (retries > 0) {
            try {
                if (!model) throw new Error("Gemini Model not initialized (Check API Key)");

                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text();
            } catch (error) {
                const mapError = (e) => {
                    if (e.message.includes('429')) return "Rate Limit";
                    if (e.message.includes('Quota')) return "Quota Exceeded";
                    if (e.message.includes('503')) return "Service Unavailable";
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
        return "I'm checking that for you... just a moment. (Network busy, please type 'Hi' again)";
    }
}

module.exports = { getAIResponse };
