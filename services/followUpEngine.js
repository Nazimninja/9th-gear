/**
 * Follow-up Engine — automated follow-ups + smart car alerts
 *
 * FOLLOW-UP RULES:
 *  - Day 3 of silence:  Send follow-up #1
 *  - Day 6 of silence:  Send follow-up #2
 *  - After 2 follow-ups with no response: Mark "Follow-Up Stopped", stop forever
 *
 * CAR ALERT RULES:
 *  - After each hourly scrape, compare new vs old inventory
 *  - If a NEW car matches a known lead's requirement → text them once
 *  - Column I in Leads tracks which cars were already alerted (no duplicates)
 *
 * All state (last active, follow-up count, alerts sent) stored in Leads sheet
 * → persists across Railway restarts.
 */

const {
    getLeadsForFollowUp,
    updateLastActive,
    updateFollowUpCount,
    updateLeadStatus,
    markCarAlertSent,
} = require('./sheets');

// ─── Timing ──────────────────────────────────────────────────────────────────
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

// ─── Follow-up message templates ─────────────────────────────────────────────
const FOLLOW_UP_1_MSG = (name) =>
    `Hi ${name}! 👋 Just checking in from *9th Gear* 🚗

Were you still looking for a luxury pre-owned car? We have some exciting options available right now!

Feel free to reply anytime — happy to help you find the perfect car 😊`;

const FOLLOW_UP_2_MSG = (name) =>
    `Hi ${name}! 🙏 One last check-in from *9th Gear*

If you're still exploring premium pre-owned cars in Bangalore, we're here to help. Our team is always available for a no-pressure conversation.

Just reply whenever you're ready! 🚗✨`;

const CAR_ALERT_MSG = (name, car) =>
    `Hi ${name}! 🎉 Great news from *9th Gear*!

We just listed a vehicle that matches what you were looking for:

🚗 *${car.model}*
💰 ${car.price}
📋 ${car.details || ''}
🔗 ${car.url}

Would you like more details or to schedule a viewing? Just reply and we'll take care of everything! 😊`;

// ─── WhatsApp client reference (set on startup) ──────────────────────────────
let _waClient = null;

/**
 * Call once on bot startup with the whatsapp-web.js client instance.
 */
function setWhatsAppClient(client) {
    _waClient = client;
}

/**
 * Send a WhatsApp message to a phone number (in wa format: 91XXXXXXXXXX@c.us)
 */
async function sendMessage(phone, text) {
    if (!_waClient) {
        console.error('[FollowUp] WhatsApp client not set — cannot send message');
        return false;
    }
    try {
        // Phone stored in sheets as plain number, convert to WA format
        const cleanPhone = phone.toString().replace(/\D/g, '');
        const waId = `${cleanPhone}@c.us`;
        await _waClient.sendMessage(waId, text);
        return true;
    } catch (err) {
        console.error(`[FollowUp] sendMessage error to ${phone}:`, err.message);
        return false;
    }
}

// ─── FOLLOW-UP CHECK ─────────────────────────────────────────────────────────

/**
 * Run once daily. Reads all leads, sends follow-ups where due.
 * Called by startFollowUpScheduler() every 24 hours.
 */
async function runFollowUpCheck() {
    console.log('[FollowUp] 📋 Daily follow-up check starting...');
    try {
        const leads = await getLeadsForFollowUp();
        const now = Date.now();
        let sent1 = 0, sent2 = 0, dropped = 0;

        for (const lead of leads) {
            const { name, phone, status, followUpCount, lastActiveMs } = lead;

            // Skip leads that are done, already stopped, or never had a conversation
            if (!phone || !lastActiveMs) continue;
            if (['Dropped', 'Follow-Up Stopped', 'Won'].includes(status)) continue;

            const silentMs = now - lastActiveMs;
            const count = parseInt(followUpCount) || 0;

            if (count === 0 && silentMs >= THREE_DAYS_MS) {
                // ── Send Follow-up #1 ───────────────────────────────────────
                const sent = await sendMessage(phone, FOLLOW_UP_1_MSG(name || 'there'));
                if (sent) {
                    await updateFollowUpCount(phone, 1);
                    await updateLeadStatus(phone, 'Follow-Up #1 Sent');
                    console.log(`[FollowUp] ✅ Sent #1 to ${name} (${phone})`);
                    sent1++;
                }

            } else if (count === 1 && silentMs >= SIX_DAYS_MS) {
                // ── Send Follow-up #2 ───────────────────────────────────────
                const sent = await sendMessage(phone, FOLLOW_UP_2_MSG(name || 'there'));
                if (sent) {
                    await updateFollowUpCount(phone, 2);
                    await updateLeadStatus(phone, 'Follow-Up #2 Sent');
                    console.log(`[FollowUp] ✅ Sent #2 to ${name} (${phone})`);
                    sent2++;
                }

            } else if (count >= 2 && silentMs >= SIX_DAYS_MS) {
                // ── No response after 2 follow-ups → stop ────────────────────
                await updateLeadStatus(phone, 'Follow-Up Stopped');
                console.log(`[FollowUp] ⛔ Stopped follow-ups for ${name} (${phone}) — no response after 2 attempts`);
                dropped++;
            }
        }

        console.log(`[FollowUp] ✅ Check done. #1 sent: ${sent1} | #2 sent: ${sent2} | Stopped: ${dropped}`);
    } catch (err) {
        console.error('[FollowUp] runFollowUpCheck error:', err.message);
    }
}

// ─── CAR ALERT ───────────────────────────────────────────────────────────────

/**
 * Compare previous and new inventory. For every genuinely NEW car,
 * find leads whose requirements match and send them a targeted alert.
 *
 * @param {Array} previousVehicles  - Inventory before this scrape
 * @param {Array} newVehicles       - Inventory after this scrape
 * @param {Boolean} forceAlert      - If true, treat all newVehicles as "new"
 */
async function sendCarAlerts(previousVehicles, newVehicles, forceAlert = false) {
    try {
        let newCars = [];
        if (forceAlert) {
            newCars = newVehicles || [];
        } else {
            // Find cars that are in the new list but were NOT in the previous list
            const prevUrls = new Set((previousVehicles || []).map(v => v.url));
            newCars = (newVehicles || []).filter(v => v.url && !prevUrls.has(v.url));
        }

        if (newCars.length === 0) {
            return; // No new listings this cycle
        }

        console.log(`[CarAlert] 🆕 ${newCars.length} car(s) detected for alerting (forceAlert=${forceAlert})`);

        // Read all leads that are still active (could be interested)
        const leads = await getLeadsForFollowUp();
        const activeleads = leads.filter(l =>
            l.phone &&
            l.requirement &&
            !['Dropped', 'Follow-Up Stopped', 'Won'].includes(l.status)
        );

        let alertsSent = 0;

        for (const car of newCars) {
            const carModelUpper = car.model.toUpperCase();

            for (const lead of activeleads) {
                // Check if this car was already alerted to this lead
                const alreadyAlerted = (lead.carAlertsLog || '').toUpperCase().includes(carModelUpper);
                if (alreadyAlerted) continue;

                // Fuzzy match: check if any keyword from the lead's requirement
                // appears in the car model name
                if (requirementMatchesCar(lead.requirement, carModelUpper)) {
                    const sent = await sendMessage(lead.phone, CAR_ALERT_MSG(lead.name || 'there', car));
                    if (sent) {
                        await markCarAlertSent(lead.phone, car.model);
                        console.log(`[CarAlert] ✅ Sent alert to ${lead.name} (${lead.phone}) for ${car.model}`);
                        alertsSent++;
                        // Small delay to avoid flooding WhatsApp
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }
        }

        if (alertsSent > 0) {
            console.log(`[CarAlert] 🎯 ${alertsSent} car alert(s) sent.`);
        }
    } catch (err) {
        console.error('[CarAlert] sendCarAlerts error:', err.message);
    }
}

/**
 * Check if a lead's requirement text matches a car model.
 * Extracts meaningful keywords and checks against car model.
 *
 * Examples:
 *   "Looking for GLA or GLC under 40L" → matches "MERCEDES BENZ GLA 200" ✅
 *   "BMW SUV 5 series"                 → matches "BMW 520D LUXURY" ✅
 *   "Audi Q5"                          → matches "AUDI Q5 PREMIUM PLUS" ✅
 */
function requirementMatchesCar(requirement, carModelUpper) {
    if (!requirement) return false;

    const req = requirement.toUpperCase();

    // Specific model extraction (prioritize these)
    const specificModels = ['GLA', 'GLC', 'GLE', 'GLS', 'X1', 'X3', 'X5', 'X7', 'Q3', 'Q5', 'Q7', 'A3', 'A4', 'A6', 'A8', '520D', '320D', 'DEFENDER', 'EVOQUE', 'VELAR', 'DISCOVERY'];
    for (const model of specificModels) {
        if (req.includes(model) && carModelUpper.includes(model)) return true;
    }

    // Brands
    const brands = ['MERCEDES', 'BMW', 'AUDI', 'LAND ROVER', 'JAGUAR', 'VOLVO', 'PORSCHE', 'MINI', 'COOPER'];
    for (const brand of brands) {
        if (req.includes(brand) && carModelUpper.includes(brand)) {
            // If they only say "BMW", we probably match many things. 
            // Let's refine: if they say "BMW" and something else, check if the "something else" matches too.
            const remaining = req.replace(brand, '').trim();
            if (!remaining) return true; // Just "BMW" requirement

            const words = remaining.split(/\s+/).filter(w => w.length >= 2);
            if (words.length === 0) return true;

            // Check if any of the other words match
            if (words.some(word => carModelUpper.includes(word))) return true;
        }
    }

    // Generic keywords extraction
    const skipWords = new Set(['A', 'AN', 'THE', 'OR', 'AND', 'FOR', 'UNDER', 'OVER', 'WITH',
        'IN', 'AT', 'TO', 'OF', 'LOOKING', 'WANT', 'NEED', 'BUY', 'CAR', 'USED',
        'LUXURY', 'SECOND', 'HAND', 'PRE', 'OWNED', 'BUDGET', 'AROUND', 'APPROX']);

    const tokens = req
        .replace(/[₹,\.]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !skipWords.has(t) && !/^\d+L?$/.test(t));

    // If we have specific tokens, check if at least ONE matches
    if (tokens.length > 0) {
        return tokens.some(token => carModelUpper.includes(token));
    }

    return false;
}

/**
 * Forced test for car alerts. Pretends all cars in current inventory are NEW
 * and alerts matching leads who haven't received them yet.
 */
async function runManualAlertTest(businessInfo) {
    console.log('[CarAlert] 🧪 Starting manual alert test...');
    if (!businessInfo || !businessInfo.vehicles || businessInfo.vehicles.length === 0) {
        console.warn('[CarAlert] No vehicles in inventory to test with.');
        return;
    }
    // We pass true for forceAlert
    await sendCarAlerts([], businessInfo.vehicles, true);
}

// ─── SCHEDULER ───────────────────────────────────────────────────────────────

/**
 * Start the daily follow-up scheduler.
 * Runs once at the next 9:00 AM IST, then every 24 hours.
 *
 * @param {Object} client  - whatsapp-web.js Client instance
 */
function startFollowUpScheduler(client) {
    setWhatsAppClient(client);

    // Calculate milliseconds until next 9:00 AM IST (UTC+5:30)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(now.getTime() + istOffset);
    const next9AM = new Date(nowIST);
    next9AM.setUTCHours(3, 30, 0, 0); // 9:00 AM IST = 3:30 AM UTC
    if (next9AM <= nowIST) next9AM.setUTCDate(next9AM.getUTCDate() + 1);
    const msUntil9AM = next9AM.getTime() - nowIST.getTime();

    console.log(`[FollowUp] ⏰ Scheduler started — first run in ${Math.round(msUntil9AM / 60000)}min (9 AM IST)`);

    setTimeout(() => {
        runFollowUpCheck();
        setInterval(runFollowUpCheck, 24 * 60 * 60 * 1000);
    }, msUntil9AM);
}

module.exports = {
    runFollowUpCheck,
    sendCarAlerts,
    runManualAlertTest,
    startFollowUpScheduler,
};
