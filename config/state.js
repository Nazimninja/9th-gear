// In-memory store (Replace with DB for production persistence)
const userStates = {};
const handoffTimers = {};

function getOrInitState(userId) {
    if (!userStates[userId]) {
        userStates[userId] = {
            step: 0, // 0 = Idle, 1 = Vehicle Asked, 2 = Location Asked, 3 = Qualified
            vehicleInterest: null,
            location: null,
            status: "New",
            history: []
        };
    }
    return userStates[userId];
}

function updateState(userId, newData) {
    if (!userStates[userId]) return;
    userStates[userId] = { ...userStates[userId], ...newData };
}

function setHandoff(userId, durationMs) {
    // Clear existing timer if any
    if (handoffTimers[userId]) clearTimeout(handoffTimers[userId]);

    // Set handoff active
    if (!userStates[userId]) getOrInitState(userId);
    userStates[userId].handoffActive = true;
    userStates[userId].handoffUntil = Date.now() + durationMs;

    // Auto-resume after duration
    handoffTimers[userId] = setTimeout(() => {
        resetHandoff(userId);
    }, durationMs);
}

function isHandedOff(userId) {
    if (!userStates[userId]) return false;
    if (userStates[userId].handoffActive && Date.now() < userStates[userId].handoffUntil) {
        return true;
    }
    // If time expired, reset automatically
    if (userStates[userId].handoffActive) {
        resetHandoff(userId);
    }
    return false;
}

function resetHandoff(userId) {
    if (userStates[userId]) {
        userStates[userId].handoffActive = false;
        userStates[userId].handoffUntil = null;
        console.log(`Re-enabling AI for ${userId}`);
    }
}

module.exports = {
    getOrInitState,
    updateState,
    setHandoff,
    isHandedOff,
    resetHandoff
};
