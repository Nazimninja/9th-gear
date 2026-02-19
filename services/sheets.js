const { google } = require('googleapis');
require('dotenv').config();

async function appendToSheet(data) {
    try {
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !process.env.SPREADSHEET_ID) {
            console.warn("Google Sheets credentials or ID missing. Skipping log.");
            return;
        }

        let authOptions = {
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        };

        const googleCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

        // Robust Check: Is it a File Path or JSON Content?
        if (googleCreds && googleCreds.trim().startsWith('{')) {
            // It's JSON Content (Cloud Deployment)
            try {
                authOptions.credentials = JSON.parse(googleCreds);
            } catch (err) {
                console.error("❌ Failed to parse GOOGLE_APPLICATION_CREDENTIALS JSON:", err.message);
                return;
            }
        } else if (googleCreds) {
            // It's a File Path (Local)
            authOptions.keyFile = googleCreds;
        } else {
            // Try explicit JSON env var if available
            if (process.env.GOOGLE_CREDENTIALS_JSON) {
                try {
                    authOptions.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
                } catch (jsonErr) {
                    console.error("❌ Failed to parse GOOGLE_CREDENTIALS_JSON:", jsonErr.message);
                    return;
                }
            } else {
                console.warn("⚠️ No Google Sheets credentials found (File or JSON).");
                return;
            }
        }

        const auth = new google.auth.GoogleAuth(authOptions);
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
