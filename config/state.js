const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/user_db.json');

// Memory Cache
let userStates = {};
let handoffTimers = {};

// Load DB on Init
try {
    if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH);
        userStates = JSON.parse(raw);
        console.log(`[State] Loaded ${Object.keys(userStates).length} user sessions from disk.`);
    }
} catch (e) {
    console.error("[State] Failed to load DB:", e.message);
}

function saveDB() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(userStates, null, 2));
    } catch (e) {
        console.error("[State] Failed to save DB:", e.message);
    }
}

function getOrInitState(userId) {
    if (!userStates[userId]) {
        userStates[userId] = {
            step: 0, // 0 = Idle, 1 = Location Asked, 2 = Car Asked
            vehicleInterest: null,
            location: null,
            status: "New",
            history: [],
            hasLogged: false,
            lastSeen: Date.now()
        };
        saveDB();
    }
    return userStates[userId];
}

function updateState(userId, newData) {
    if (!userStates[userId]) return;
    userStates[userId] = { ...userStates[userId], ...newData, lastSeen: Date.now() };
    saveDB(); // Persist on every update
}

function setHandoff(userId, durationMs) {
    if (handoffTimers[userId]) clearTimeout(handoffTimers[userId]);

    if (!userStates[userId]) getOrInitState(userId);
    userStates[userId].handoffActive = true;
    userStates[userId].handoffUntil = Date.now() + durationMs;
    saveDB();

    handoffTimers[userId] = setTimeout(() => {
        resetHandoff(userId);
    }, durationMs);
}

function isHandedOff(userId) {
    if (!userStates[userId]) return false;

    // Check expired
    if (userStates[userId].handoffActive && Date.now() > userStates[userId].handoffUntil) {
        resetHandoff(userId); // Auto-reset
        return false;
    }

    return userStates[userId].handoffActive;
}

function resetHandoff(userId) {
    if (userStates[userId]) {
        userStates[userId].handoffActive = false;
        userStates[userId].handoffUntil = null;
        console.log(`[State] Re-enabling AI for ${userId}`);
        saveDB();
    }
}

module.exports = {
    getOrInitState,
    updateState,
    setHandoff,
    isHandedOff,
    resetHandoff
};
