const { google } = require('googleapis');
require('dotenv').config();

// ============================================================
// Build Google Auth from env vars (supports file path or JSON string)
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
        // File path (local development)
        authOptions.keyFile = googleCreds;
    }

    const auth = new google.auth.GoogleAuth(authOptions);
    return auth.getClient();
}

// ============================================================
// HELPER — find a customer's sheet row by phone number
// Searches column C (index 2), returns 1-indexed row number or -1
// ============================================================
async function findRowByPhone(sheets, phone) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: 'Sheet1!A:F'
    });

    const rows = res.data.values || [];
    const cleanedPhone = phone.toString().replace(/\D/g, '');

    // Search from bottom up — get most recent row for this number
    for (let i = rows.length - 1; i >= 0; i--) {
        const rowPhone = (rows[i][2] || '').toString().replace(/\D/g, '');
        if (rowPhone === cleanedPhone) {
            return i + 1; // 1-indexed
        }
    }
    return -1;
}

// ============================================================
// APPEND — Logs new row when customer first messages
// Columns: A=Date | B=Name | C=Phone | D=Requirement | E=Location | F=Status
// ============================================================
async function appendToSheet(data) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Sheet1!A:F',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [[
                    data.date,                        // A: Date (IST)
                    data.name,                        // B: Customer Name
                    data.phone,                       // C: Clean Phone Number
                    data.requirement || 'New Enquiry',// D: Car Requirement
                    data.location || '',              // E: Location
                    data.status || 'New Lead'         // F: Status
                ]]
            }
        });

        console.log(`[Sheets] ✅ New lead logged: ${data.name} (${data.phone})`);
    } catch (error) {
        console.error('[Sheets] appendToSheet Error:', error.message);
    }
}

// ============================================================
// UPDATE REQUIREMENT — Updates Column D for a customer's row
// ============================================================
async function updateRequirement(phone, name, requirement) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const targetRow = await findRowByPhone(sheets, phone);

        if (targetRow === -1) {
            console.log(`[Sheets] Phone ${phone} not found, appending new requirement row.`);
            await appendToSheet({
                date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                name: name,
                phone: phone,
                requirement: requirement,
                location: '',
                status: 'Active Lead'
            });
            return;
        }

        // Update Requirement (D) and Status (F)
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `Sheet1!D${targetRow}:D${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[requirement]] }
        });

        // Update status to Active Lead
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `Sheet1!F${targetRow}:F${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [['Active Lead']] }
        });

        console.log(`[Sheets] ✅ Requirement updated (row ${targetRow}): "${requirement}"`);
    } catch (error) {
        console.error('[Sheets] updateRequirement Error:', error.message);
    }
}

// ============================================================
// UPDATE LOCATION — Updates Column E for a customer's row
// ============================================================
async function updateLocation(phone, location) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const targetRow = await findRowByPhone(sheets, phone);

        if (targetRow === -1) {
            console.log(`[Sheets] Phone ${phone} not found for location update. Skipping.`);
            return;
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `Sheet1!E${targetRow}:E${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[location]] }
        });

        // Also mark as Qualified if they're a Bangalore area
        if (location.toLowerCase().includes('bangalore')) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `Sheet1!F${targetRow}:F${targetRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [['Qualified Lead']] }
            });
        }

        console.log(`[Sheets] ✅ Location updated (row ${targetRow}): "${location}"`);
    } catch (error) {
        console.error('[Sheets] updateLocation Error:', error.message);
    }
}

module.exports = { appendToSheet, updateRequirement, updateLocation };
