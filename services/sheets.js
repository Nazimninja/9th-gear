const { google } = require('googleapis');
require('dotenv').config();

// ============================================================
// SHEET TAB CONFIG
// Change SHEET_TAB to write to a different tab at any time.
// ============================================================
const SHEET_TAB = 'Leads'; // New clean tab — fresh start
// Column layout: A=Date | B=Name | C=Phone | D=Requirement | E=Location | F=Status

// ============================================================
// Build Google Auth
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
        try {
            authOptions.credentials = JSON.parse(googleCreds);
        } catch (err) {
            throw new Error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS JSON: ' + err.message);
        }
    } else {
        authOptions.keyFile = googleCreds;
    }

    const auth = new google.auth.GoogleAuth(authOptions);
    return auth.getClient();
}

// ============================================================
// HELPER — Find customer's row in Leads tab by phone (column C)
// Returns 1-indexed row number, or -1 if not found
// ============================================================
async function findRowByPhone(sheets, phone) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${SHEET_TAB}!A:F`
    });

    const rows = res.data.values || [];
    const cleanedPhone = phone.toString().replace(/\D/g, '');

    for (let i = rows.length - 1; i >= 0; i--) {
        const rowPhone = (rows[i][2] || '').toString().replace(/\D/g, '');
        if (rowPhone === cleanedPhone) {
            return i + 1; // 1-indexed
        }
    }
    return -1;
}

// ============================================================
// APPEND — Log new lead row on first message
// Columns: A=Date | B=Name | C=Phone | D=Requirement | E=Location | F=Status
// ============================================================
async function appendToSheet(data) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!A:F`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [[
                    data.date,
                    data.name,
                    data.phone,
                    data.requirement || '',
                    data.location || '',
                    data.status || 'New Lead'
                ]]
            }
        });

        console.log(`[Sheets] ✅ Row appended to "${SHEET_TAB}": ${data.name} (${data.phone})`);
    } catch (error) {
        console.error(`[Sheets] appendToSheet Error:`, error.message);
    }
}

// ============================================================
// UPDATE REQUIREMENT — Updates column D for the customer's row
// ============================================================
async function updateRequirement(phone, name, requirement) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        const targetRow = await findRowByPhone(sheets, phone);

        if (targetRow === -1) {
            // Not found — append fresh row
            await appendToSheet({
                date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                name,
                phone,
                requirement,
                location: '',
                status: 'Active Lead'
            });
            return;
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!D${targetRow}:D${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[requirement]] }
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!F${targetRow}:F${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [['Active Lead']] }
        });

        console.log(`[Sheets] ✅ Requirement updated (row ${targetRow}): "${requirement}"`);
    } catch (error) {
        console.error(`[Sheets] updateRequirement Error:`, error.message);
    }
}

// ============================================================
// UPDATE LOCATION — Updates column E for the customer's row
// Bangalore leads are automatically marked "Qualified Lead"
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
            range: `${SHEET_TAB}!E${targetRow}:E${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[location]] }
        });

        if (location.toLowerCase().includes('bangalore')) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `${SHEET_TAB}!F${targetRow}:F${targetRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [['Qualified Lead']] }
            });
        }

        console.log(`[Sheets] ✅ Location updated (row ${targetRow}): "${location}"`);
    } catch (error) {
        console.error(`[Sheets] updateLocation Error:`, error.message);
    }
}

module.exports = { appendToSheet, updateRequirement, updateLocation };
