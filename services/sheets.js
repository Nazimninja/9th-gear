const { google } = require('googleapis');
require('dotenv').config();

// ============================================================
// SHEET TAB CONFIG
// ============================================================
const SHEET_TAB = 'Leads';
//  A = Date First Contacted
//  B = Customer Name
//  C = Phone Number
//  D = Car Requirement (what they want)
//  E = Location (city/area)
//  F = Status (New Lead / Active Lead / Qualified Lead / Follow-Up #1 Sent / Follow-Up #2 Sent / Follow-Up Stopped / Won)
//  G = Last Active Date (last time customer replied to bot)
//  H = Follow-Up Count (0, 1, 2 — tracks how many follow-ups were sent)
//  I = Car Alerts Sent (models already alerted — prevents duplicate alerts)
const CONVOLOG_TAB = 'ConvoLog'; // A=Date | B=Name | C=Phone | D=Summary | E=Outcome
const LEARNING_TAB = 'Learning'; // A=Date | B=Coaching Tip

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

// ============================================================
// INIT LEADS HEADERS — writes column headers to row 1 if sheet is empty
// Makes the sheet self-documenting for Nazim to read easily
// ============================================================
async function initLeadsHeaders() {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        // Check if row 1 already has headers
        const check = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!A1:I1`
        });
        const row1 = (check.data.values || [[]])[0] || [];
        if (row1[0] === 'Date First Contacted') return; // already has headers

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!A1:I1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[
                    'Date First Contacted',
                    'Customer Name',
                    'Phone Number',
                    'Car Requirement',
                    'Location / City',
                    'Status',
                    'Last Active Date',
                    'Follow-Up Count',
                    'Car Alerts Sent (models)'
                ]]
            }
        });
        console.log('[Sheets] ✅ Leads tab headers written.');
    } catch (err) {
        console.error('[Sheets] initLeadsHeaders error:', err.message);
    }
}

// ============================================================
// UPDATE LAST ACTIVE — write timestamp to column G
// Called after every customer message received by the bot
// ============================================================
async function updateLastActive(phone) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const targetRow = await findRowByPhone(sheets, phone);
        if (targetRow === -1) return;

        const ts = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!G${targetRow}:G${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[ts]] }
        });
    } catch (err) {
        console.error('[Sheets] updateLastActive error:', err.message);
    }
}

// ============================================================
// GET LEADS FOR FOLLOW-UP — read all leads with follow-up data
// Returns array of lead objects including follow-up columns G/H/I
// ============================================================
async function getLeadsForFollowUp() {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!A:I`
        });
        const rows = (res.data.values || []);
        // Skip header row if present
        const dataRows = rows.filter(r => r[0] && r[0] !== 'Date First Contacted');

        return dataRows.map(r => {
            const lastActiveStr = r[6] || '';  // Column G
            const lastActiveMs = lastActiveStr ? new Date(lastActiveStr).getTime() : 0;
            return {
                date: r[0] || '',
                name: r[1] || 'Customer',
                phone: r[2] || '',
                requirement: r[3] || '',
                location: r[4] || '',
                status: r[5] || 'New Lead',
                lastActive: lastActiveStr,
                lastActiveMs: isNaN(lastActiveMs) ? 0 : lastActiveMs,
                followUpCount: parseInt(r[7] || '0', 10),
                carAlertsLog: r[8] || '',
            };
        });
    } catch (err) {
        console.error('[Sheets] getLeadsForFollowUp error:', err.message);
        return [];
    }
}

// ============================================================
// UPDATE FOLLOW-UP COUNT — write count (0/1/2) to column H
// ============================================================
async function updateFollowUpCount(phone, count) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const targetRow = await findRowByPhone(sheets, phone);
        if (targetRow === -1) return;

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!H${targetRow}:H${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[count]] }
        });
    } catch (err) {
        console.error('[Sheets] updateFollowUpCount error:', err.message);
    }
}

// ============================================================
// UPDATE LEAD STATUS — write status string to column F
// e.g. 'Follow-Up #1 Sent', 'Follow-Up Stopped', 'Won'
// ============================================================
async function updateLeadStatus(phone, status) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const targetRow = await findRowByPhone(sheets, phone);
        if (targetRow === -1) return;

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!F${targetRow}:F${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[status]] }
        });
        console.log(`[Sheets] ✅ Status updated for ${phone}: ${status}`);
    } catch (err) {
        console.error('[Sheets] updateLeadStatus error:', err.message);
    }
}

// ============================================================
// MARK CAR ALERT SENT — append car model name to column I
// Prevents the same car from being re-alerted to the same customer
// ============================================================
async function markCarAlertSent(phone, carModel) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const targetRow = await findRowByPhone(sheets, phone);
        if (targetRow === -1) return;

        // Read current column I value
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!I${targetRow}:I${targetRow}`
        });
        const existing = ((res.data.values || [[]])[0] || [''])[0] || '';
        const updated = existing ? `${existing}, ${carModel}` : carModel;

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${SHEET_TAB}!I${targetRow}:I${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[updated]] }
        });
        console.log(`[Sheets] ✅ Car alert logged for ${phone}: ${carModel}`);
    } catch (err) {
        console.error('[Sheets] markCarAlertSent error:', err.message);
    }
}

// ============================================================
// CONVERSATION LOG — write to ConvoLog tab
// Called by the learning engine after each conversation.
// ============================================================
async function appendConversationLog({ date, name, phone, summary, outcome }) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${CONVOLOG_TAB}!A:E`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [[date, name, phone, summary, outcome]] }
        });
        console.log(`[Sheets] ✅ ConvoLog: ${name} (${outcome})`);
    } catch (err) {
        if (err.message && err.message.includes('Unable to parse range')) {
            console.warn('[Sheets] ConvoLog tab not found — create a tab named "ConvoLog" in your Google Sheet.');
            return;
        }
        console.error('[Sheets] appendConversationLog error:', err.message);
    }
}

// ============================================================
// LEARNING TIP — write one tip to Learning tab
// ============================================================
async function appendLearningTip({ date, tip }) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${LEARNING_TAB}!A:B`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [[date, tip]] }
        });
    } catch (err) {
        if (err.message && err.message.includes('Unable to parse range')) {
            console.warn('[Sheets] Learning tab not found — create a tab named "Learning" in your Google Sheet.');
            return;
        }
        console.error('[Sheets] appendLearningTip error:', err.message);
    }
}

// ============================================================
// GET CONVERSATION LOGS — read recent rows from ConvoLog tab
// Returns array of {date, name, phone, summary, outcome}
// ============================================================
async function getConversationLogs(limit = 30) {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${CONVOLOG_TAB}!A:E`
        });
        const rows = (res.data.values || []).filter(r => r[0] && r[3]); // must have date + summary
        const recent = rows.slice(-limit);
        return recent.map(r => ({
            date: r[0] || '',
            name: r[1] || 'Unknown',
            phone: r[2] || '',
            summary: r[3] || '',
            outcome: r[4] || 'Unknown',
        }));
    } catch (err) {
        console.error('[Sheets] getConversationLogs error:', err.message);
        return [];
    }
}

// ============================================================
// GET LEARNING TIPS — read all tips from Learning tab
// Returns array of tip strings (empty if tab doesn't exist yet)
// ============================================================
async function getLearningTipsFromSheet() {
    try {
        const client = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: client });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${LEARNING_TAB}!A:B`
        });
        const rows = (res.data.values || []).filter(r => r[1] && r[1].trim().length > 5);
        return rows.map(r => r[1].trim()); // column B = tip text
    } catch (err) {
        // If the Learning tab doesn't exist yet, quietly return empty (not an error)
        if (err.message && (err.message.includes('Unable to parse range') || err.message.includes('not found'))) {
            return []; // Tab not created yet — will be created when first tip is saved
        }
        console.error('[Sheets] getLearningTipsFromSheet error:', err.message);
        return [];
    }
}

module.exports = {
    // Core lead management
    appendToSheet,
    updateRequirement,
    updateLocation,
    // Follow-up engine
    initLeadsHeaders,
    updateLastActive,
    getLeadsForFollowUp,
    updateFollowUpCount,
    updateLeadStatus,
    markCarAlertSent,
    // Learning engine
    appendConversationLog,
    appendLearningTip,
    getConversationLogs,
    getLearningTipsFromSheet,
};
