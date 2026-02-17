const axios = require('axios');
require('dotenv').config();

async function testRestApi() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const data = {
        contents: [{ parts: [{ text: "Hello" }] }]
    };

    try {
        console.log("Testing REST API...");
        const response = await axios.post(url, data, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("Success! Status:", response.status);
        console.log("Response:", JSON.stringify(response.data, null, 2));
    } catch (error) {
        if (error.response) {
            console.error("API Error:", error.response.status, error.response.statusText);
            console.error("Details:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("Request Error:", error.message);
        }
    }
}

testRestApi();
