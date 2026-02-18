const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // There isn't a direct listModels in the high-level SDK easily exposed, 
        // but we can try a known model and print error details if it fails.
        // Actually, we can use the model to generate content and see if it works.

        const models = ["gemini-1.5-flash", "gemini-pro", "gemini-1.0-pro"];

        for (const modelName of models) {
            console.log(`Checking model: ${modelName}...`);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Test.");
                console.log(`✅ ${modelName} is AVAILABLE.`);
            } catch (error) {
                console.log(`❌ ${modelName} Failed: ${error.message}`);
            }
        }
    } catch (e) {
        console.error("Fatal Error:", e);
    }
}

listModels();
