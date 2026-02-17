const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listModels() {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        console.log("Using API Key:", apiKey ? "Yes" : "No");

        // We can't list models directly with the high-level SDK easily in all versions, 
        // but let's try a direct fetch if sdk doesn't export it conveniently, 
        // or just try a standard 'gemini-pro' request again with the NEW sdk.

        const genAI = new GoogleGenerativeAI(apiKey);

        // Try gemini-pro (1.0)
        console.log("Attempting gemini-pro...");
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const result = await model.generateContent("Test");
            console.log("gemini-pro Works!");
        } catch (e) {
            console.log("gemini-pro failed: " + e.message);
        }

        // Try gemini-1.5-flash
        console.log("Attempting gemini-1.5-flash...");
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent("Test");
            console.log("gemini-1.5-flash Works!");
        } catch (e) {
            console.log("gemini-1.5-flash failed.");
        }

    } catch (error) {
        console.error("Critical Error:", error);
    }
}

listModels();
