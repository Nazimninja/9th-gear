const { scrapeBusinessData } = require('./services/scraper');

(async () => {
    console.log("Testing scraper service...");
    const data = await scrapeBusinessData();
    console.log("Vehicles found:", data.vehicles.length);
    if (data.vehicles.length > 0) {
        console.log("First Vehicle:", data.vehicles[0]);
    }
})();
