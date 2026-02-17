const axios = require('axios');
require('dotenv').config();

async function listModelsRest() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        console.log("Listing Models via REST API...");
        const response = await axios.get(url);
        console.log("Success! Status:", response.status);

        if (response.data && response.data.models) {
            console.log("Available Models:");
            response.data.models.forEach(m => {
                if (m.name.includes('gemini')) {
                    console.log(`- ${m.name}`);
                }
            });
        } else {
            console.log("No models found in response.");
        }

    } catch (error) {
        if (error.response) {
            console.error("API Error:", error.response.status, error.response.statusText);
            console.error("Details:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("Request Error:", error.message);
        }
    }
}

listModelsRest();
