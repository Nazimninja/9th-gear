const { appendToSheet } = require('./services/sheets');
require('dotenv').config();

async function testSheets() {
    console.log("Testing Sheets Integration...");
    console.log("Spreadsheet ID:", process.env.SPREADSHEET_ID);

    try {
        const testData = {
            date: new Date().toISOString(),
            name: "Test User",
            phone: "0000000000",
            vehicle: "Test Car",
            location: "Test Location",
            status: "Test Status"
        };

        const result = await appendToSheet(testData);
        console.log("Sheet Append Result:", result);
    } catch (error) {
        console.error("Sheet Connection Failed:", error);
    }
}

testSheets();
