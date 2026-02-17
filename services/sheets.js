const { google } = require('googleapis');
require('dotenv').config();

async function appendToSheet(data) {
    try {
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !process.env.SPREADSHEET_ID) {
            console.warn("Google Sheets credentials or ID missing. Skipping log.");
            return;
        }

        const auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const client = await auth.getClient();
        const email = client.email || (await auth.getCredentials()).client_email;
        console.log(`[Sheets] Authenticated as: ${email}`);

        const sheets = google.sheets({ version: 'v4', auth: client });

        const request = {
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Sheet1!A:F', // Assumes columns: Date, Name, Phone, Vehicle, Location, Status
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [
                    [data.date, data.name, data.phone, data.vehicle, data.location, data.status]
                ],
            },
        };

        await sheets.spreadsheets.values.append(request);
        console.log(`Logged lead to Sheets: ${data.phone}`);

    } catch (error) {
        console.error("Google Sheets Error:", error);
    }
}

module.exports = { appendToSheet };
