const { appendToSheet } = require('./services/sheets');
require('dotenv').config();

(async () => {
    console.log("Testing Google Sheets Connection...");
    try {
        await appendToSheet({
            date: new Date().toISOString(),
            name: "Test User (System Check)",
            phone: "9100000000",
            vehicle: "Debug Check",
            location: "Test Location",
            status: "System Test"
        });
        console.log("✅ SUCCESS: Test row added to Google Sheet.");
    } catch (error) {
        console.error("❌ FAILURE:", error.message);
        if (error.message.includes("invalid_grant")) {
            console.error("  -> Hint: Check your GOOGLE_APPLICATION_CREDENTIALS or System Time.");
        }
        if (error.message.includes("404")) {
            console.error("  -> Hint: Check your SPREADSHEET_ID.");
        }
    }
})();
