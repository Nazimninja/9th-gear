const { GoogleGenerativeAI } = require('@google/generative-ai');
const businessInfo = require('../config/businessInfo');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

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
                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text();
            } catch (error) {
                const isRateLimit = error.message.includes('429') || error.message.includes('Quota') || error.message.includes('503');
                console.error(`Gemini API Error (Attempts left: ${retries - 1}):`, isRateLimit ? "Rate Limit/Quota Hit" : error.message);

                if (retries === 1) throw error; // Throw on last attempt
                retries--;
                // Wait longer if it's a rate limit (4s, 8s, etc.)
                const delay = isRateLimit ? 4000 * (4 - retries) : 2000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

    } catch (error) {
        console.error("Gemini API Final Error:", error);
        return "I'm checking that for you... just a moment. (Network busy, please type 'Hi' again)";
    }
}

module.exports = { getAIResponse };
