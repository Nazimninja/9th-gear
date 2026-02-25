/**
 * Live Inventory Scraper — fetches real-time data from 9thgear.co.in
 *
 * Strategy:
 *  - Uses axios with full browser-like headers to bypass 406/Cloudflare blocks
 *  - Parses with cheerio using the exact HTML selectors from the live site
 *  - EXCLUDES sold cars (they have `carstatus` class on their car-image)
 *  - Refreshes inventory every hour so sold cars are removed promptly
 *  - Falls back to last successful scrape if network fails
 */

const axios = require('axios');
const cheerio = require('cheerio');

const INVENTORY_URL = 'https://www.9thgear.co.in/luxury-used-cars-bangalore';

// Full browser-like headers to avoid 406 / bot-block responses
// NOTE: Accept-Encoding is intentionally omitted (or set to identity) so that
// axios receives plain text, not gzip binary — which cheerio can't parse on Railway.
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Accept-Encoding': 'identity',   // plain text only — no gzip that cheerio can't decode
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://www.9thgear.co.in/',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
};

// Cache: last successful scrape
let cachedVehicles = [];
let lastScrapeTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Parse the 9thgear inventory page HTML into a structured array.
 *
 * Actual page structure (confirmed from live HTML):
 *
 *   <div class="main-car">
 *     <div>
 *       <a href="/luxury-used-cars/model-name/ID/">
 *         <img class="car-image [carstatus]">   ← carstatus = SOLD, skip it
 *       </a>
 *     </div>
 *     <div class="car-text">
 *       <div class="row">
 *         <span class="type">Hot Deal</span>
 *         <span class="comment">2020</span>      ← year
 *       </div>
 *       <h3><a href="...">MODEL NAME</a></h3>
 *       <span class="carbg">KA 09</span>         ← registration
 *       <span class="carbg">Diesel</span>         ← fuel
 *       <span class="carbg">97399 km</span>       ← mileage
 *       <span class="posted_by">₹ 29,75,000</span>
 *     </div>
 *   </div>
 */
function parseInventory(html) {
    const $ = cheerio.load(html);
    const vehicles = [];

    // Iterate over each car card — .main-car is the container for ONE listing
    $('div.main-car').each((i, card) => {
        try {
            // Check for sold status — img inside the card has class "carstatus"
            const imgEl = $(card).find('img.car-image');
            if (!imgEl.length) return; // no image → not a car card

            const imgClass = imgEl.attr('class') || '';
            if (imgClass.includes('carstatus')) return; // SOLD — skip

            // URL from the <a> wrapping the image
            const carUrl = $(card).find('img.car-image').parent('a').attr('href') || '';
            if (!carUrl.includes('/luxury-used-cars/')) return;
            const fullUrl = carUrl.startsWith('http')
                ? carUrl
                : `https://www.9thgear.co.in${carUrl}`;

            // Details are all inside div.car-text
            const carText = $(card).find('div.car-text');

            // Model name: <h3><a ...>MODEL NAME</a></h3>
            const model = carText.find('h3 a').first().text().trim();
            if (!model) return;

            // Year: <span class="comment">2020</span>
            const year = carText.find('span.comment').first().text().trim();

            // Detail spans: reg / fuel / km  (3 × span.carbg)
            const carbgTexts = carText.find('span.carbg')
                .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
                .get()
                .filter(Boolean);
            const details = carbgTexts.join(' · ');

            // Price: <span class="posted_by">₹ 29,75,000</span>
            // The ₹ symbol sometimes renders as '?' in encoded responses — normalise it
            const priceRaw = carText.find('span.posted_by').first().text()
                .replace(/\?/g, '₹')   // fix encoding artefact
                .replace(/Rs\.?/gi, '₹')
                .trim();
            const price = priceRaw || 'Contact for price';

            vehicles.push({ model, year, price, details, url: fullUrl });
        } catch (_) {
            // Silently skip malformed entries
        }
    });

    return vehicles;
}


/**
 * Try to extract a year from the URL slug (not always present, best-effort).
 */
function extractYearFromUrl(url) {
    const match = url.match(/\/(20\d{2})\//);
    return match ? match[1] : '';
}

/**
 * Fetch and parse the live inventory.
 * Returns cached data if recently scraped.
 * Falls back to last known data if scrape fails.
 */
async function scrapeBusinessData() {
    const now = Date.now();

    // Return cache if still fresh
    if (cachedVehicles.length > 0 && (now - lastScrapeTime) < CACHE_TTL_MS) {
        console.log(`[Scraper] Using cached inventory (${cachedVehicles.length} live cars, ${Math.round((now - lastScrapeTime) / 60000)}min old)`);
        return { vehicles: cachedVehicles };
    }

    console.log('[Scraper] Fetching live inventory from 9thgear.co.in...');

    const retries = [2000, 5000, 10000];
    for (let attempt = 0; attempt <= retries.length; attempt++) {
        try {
            const response = await axios.get(INVENTORY_URL, {
                headers: BROWSER_HEADERS,
                timeout: 20000,
                maxRedirects: 5,
                responseType: 'text',
            });

            if (!response.data || response.data.length < 1000) {
                throw new Error('Response too short — likely blocked');
            }

            const vehicles = parseInventory(response.data);

            if (vehicles.length === 0) {
                throw new Error('No cars parsed — HTML structure may have changed');
            }

            // Update cache
            cachedVehicles = vehicles;
            lastScrapeTime = now;
            console.log(`[Scraper] ✅ Live scrape success! ${vehicles.length} cars available (sold cars excluded).`);
            return { vehicles };

        } catch (err) {
            if (attempt < retries.length) {
                console.warn(`[Scraper] Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${retries[attempt] / 1000}s...`);
                await new Promise(r => setTimeout(r, retries[attempt]));
            } else {
                console.error(`[Scraper] ❌ All attempts failed: ${err.message}`);

                // Return last cached data if available
                if (cachedVehicles.length > 0) {
                    console.warn(`[Scraper] ⚠️ Returning stale cache (${cachedVehicles.length} cars) — may include sold cars`);
                    return { vehicles: cachedVehicles };
                }

                console.error('[Scraper] No cache available. Returning empty inventory.');
                return { vehicles: [] };
            }
        }
    }
}

/**
 * Start hourly inventory refresh (call once on bot startup, after first scrape).
 * After each refresh, compares old vs new to detect newly listed cars
 * and fires car alerts to matching leads.
 */
function startInventoryRefresh(businessInfo) {
    const ONE_HOUR = 60 * 60 * 1000;

    setInterval(async () => {
        console.log('[Scraper] 🔄 Hourly inventory refresh starting...');
        try {
            // Snapshot the current inventory BEFORE scraping (for new-car detection)
            const previousVehicles = [...(businessInfo.vehicles || [])];

            // Force fresh scrape by clearing the cache timestamp
            lastScrapeTime = 0;
            const data = await scrapeBusinessData();

            if (data.vehicles.length > 0) {
                businessInfo.vehicles = data.vehicles;
                console.log(`[Scraper] ✅ Inventory updated: ${data.vehicles.length} live cars.`);

                // Detect newly listed cars and alert matching leads
                // (lazy-require to avoid circular dependency at module load time)
                const { sendCarAlerts } = require('./followUpEngine');
                sendCarAlerts(previousVehicles, data.vehicles).catch(err =>
                    console.error('[Scraper] Car alert error:', err.message)
                );
            }
        } catch (err) {
            console.error('[Scraper] Hourly refresh error:', err.message);
        }
    }, ONE_HOUR);

    console.log('[Scraper] ⏰ Hourly inventory refresh scheduled.');
}

module.exports = { scrapeBusinessData, startInventoryRefresh };
