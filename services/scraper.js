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
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
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
 * Parse the 9thgear inventory listing page HTML into a structured array.
 * Skips cars with `carstatus` class on their image (= sold / unavailable).
 *
 * Real page structure (flat siblings inside each car block):
 *   <a href="/luxury-used-cars/slug/ID/"><img class="car-image [carstatus]"></a>
 *   <span class="posted_by">₹ 29,75,000</span>   ← SIBLING of <a>, not inside it
 *   <h3><a href="..." class="hover-underline-animation left">MODEL NAME</a></h3>
 *   <span class="carbg">...</span>  ← registration (KA 09)
 *   <span class="carbg">...</span>  ← fuel type (Diesel/Petrol/EV)
 *   <span class="carbg">...</span>  ← mileage (97399 km)
 */
function parseInventory(html) {
    const $ = cheerio.load(html);
    const vehicles = [];

    // Find every car image link — each is the anchor point for one car listing
    $('a img.car-image').each((i, imgEl) => {
        try {
            const imgClass = $(imgEl).attr('class') || '';

            // `carstatus` class = car is SOLD — always skip these
            if (imgClass.includes('carstatus')) return;

            const carLinkEl = $(imgEl).parent(); // the <a> tag
            const url = carLinkEl.attr('href') || '';
            if (!url.includes('/luxury-used-cars/')) return;

            const fullUrl = url.startsWith('http') ? url : `https://www.9thgear.co.in${url}`;

            // Price is the <span class="posted_by"> immediately after the <a> tag
            const priceRaw = carLinkEl.next('span.posted_by').text().trim();
            const priceNum = priceRaw.replace(/[^\d,]/g, '').trim();
            const price = priceNum ? `₹ ${priceNum}` : 'Contact for price';

            // Model name is in the next <h3> after the price span
            const model = carLinkEl.nextAll('h3').first().find('a').first().text().trim();
            if (!model) return;

            // Details: span.carbg siblings after the <a> — reg, fuel, km
            const carbgEls = carLinkEl.nextAll('span.carbg');
            const details = carbgEls.map((_, el) => $(el).text().trim()).get()
                .filter(Boolean)
                .join(', ');

            vehicles.push({ model, price, details, url: fullUrl });
        } catch (_) {
            // Skip malformed entries silently
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
 * This ensures sold cars are promptly removed within 1 hour of being taken off the site.
 */
function startInventoryRefresh(businessInfo) {
    const ONE_HOUR = 60 * 60 * 1000;

    setInterval(async () => {
        console.log('[Scraper] 🔄 Hourly inventory refresh starting...');
        try {
            // Force fresh scrape by clearing the cache
            lastScrapeTime = 0;
            const data = await scrapeBusinessData();
            if (data.vehicles.length > 0) {
                businessInfo.vehicles = data.vehicles;
                console.log(`[Scraper] ✅ Inventory updated: ${data.vehicles.length} live cars.`);
            }
        } catch (err) {
            console.error('[Scraper] Hourly refresh error:', err.message);
        }
    }, ONE_HOUR);

    console.log('[Scraper] ⏰ Hourly inventory refresh scheduled.');
}

module.exports = { scrapeBusinessData, startInventoryRefresh };
