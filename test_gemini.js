const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function testGemini() {
    try {
        console.log("Testing Gemini API...");
        const apiKey = process.env.GEMINI_API_KEY;
        console.log("API Key present:", !!apiKey);

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = "Hello, this is a test.";
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log("Success! Response:", text);
    } catch (error) {
        console.error("Gemini API Error Details:", error);
    }
}

testGemini();
