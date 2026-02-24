const { google } = require('googleapis');
require('dotenv').config();

// ============================================================
// Build Google Auth from env vars (supports both file path and JSON string)
// ============================================================
async function getAuthClient() {
    const googleCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!googleCreds || !process.env.SPREADSHEET_ID) {
        throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS or SPREADSHEET_ID env var');
    }

    let authOptions = {
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    };

    if (googleCreds.trim().startsWith('{')) {
        // JSON string (Railway / cloud deployment)
        try {
            authOptions.credentials = JSON.parse(googleCreds);
        } catch (err) {
            throw new Error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS JSON: ' + err.message);
        }
    } else {
        // File path (local)
        authOptions.keyFile = googleCreds;
    }

    const auth = new google.auth.GoogleAuth(authOptions);
    return auth.getClient();
}

// ============================================================
// APPEND — Logs a new row when customer first messages
// Columns: Date | Name | Phone | Requirement | Status
// ============================================================
async function appendToSheet(data) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Sheet1!A:E',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [[
                    data.date,        // A: Date (IST)
                    data.name,        // B: Customer Name
                    data.phone,       // C: Clean Phone Number
                    data.requirement, // D: Car Requirement
                    data.status       // E: Status
                ]]
            }
        });

        console.log(`[Sheets] ✅ New lead logged: ${data.name} (${data.phone})`);
    } catch (error) {
        console.error('[Sheets] appendToSheet Error:', error.message);
    }
}

// ============================================================
// UPDATE REQUIREMENT — Finds the customer's row by phone
// and updates the Requirement column (column D)
// ============================================================
async function updateRequirement(phone, name, requirement) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        // Read all rows to find the customer's row by phone number
        const readRes = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Sheet1!A:E'
        });

        const rows = readRes.data.values || [];
        let targetRow = -1;

        // Search from bottom up — find most recent row with this phone
        for (let i = rows.length - 1; i >= 0; i--) {
            // Phone is column C (index 2)
            if (rows[i][2] && rows[i][2].toString().replace(/\D/g, '') === phone.replace(/\D/g, '')) {
                targetRow = i + 1; // Sheets rows are 1-indexed
                break;
            }
        }

        if (targetRow === -1) {
            // Row not found — append fresh row instead
            console.log(`[Sheets] Phone ${phone} not found, appending new requirement row.`);
            await appendToSheet({
                date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                name: name,
                phone: phone,
                requirement: requirement,
                status: 'Active Lead'
            });
            return;
        }

        // Update column D (Requirement) and E (Status) on found row
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `Sheet1!D${targetRow}:E${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[requirement, 'Active Lead']]
            }
        });

        console.log(`[Sheets] ✅ Requirement updated on row ${targetRow}: "${requirement}"`);
    } catch (error) {
        console.error('[Sheets] updateRequirement Error:', error.message);
    }
}

module.exports = { appendToSheet, updateRequirement };
