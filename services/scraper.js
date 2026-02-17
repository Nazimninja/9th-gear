const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeBusinessData() {
    try {
        console.log("Fetching data from 9th Gear website...");
        const { data } = await axios.get('https://9thgear.co.in/luxury-used-cars-bangalore', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);
        const vehicles = [];

        // Parsing vehicle cards
        // Each vehicle is inside a .main-car div
        $('.main-car').each((i, element) => {
            const name = $(element).find('h3 a').text().trim();
            const url = $(element).find('h3 a').attr('href');

            // Details are in spans with class .carbg
            // We'll also try to grab any other list items or text in the card description if available.
            const details = [];
            $(element).find('.carbg').each((j, el) => {
                const text = $(el).text().trim();
                if (text) details.push(text);
            });

            // Try to find ownership if it's in a specific span or common text pattern
            // Sometimes it's just in the main text. Let's grab the full text of the card for context if needed, 
            // but for now, expanding the 'details' array is safest.
            const extraInfo = $(element).find('.item-card-desc').text().trim(); // Hypothetical class, but let's stick to what we know works first.


            // Price is in .posted_by
            const price = $(element).find('.posted_by').text().trim();
            const year = $(element).find('.comment').text().trim();

            if (name) {
                vehicles.push({
                    model: name,
                    year: year,
                    price: price,
                    details: details.join(', '), // e.g. "KA, Petrol, 18199 km"
                    url: url ? (url.startsWith('http') ? url : `https://9thgear.co.in/${url}`) : null
                });
            }
        });

        console.log(`Scraped ${vehicles.length} vehicles.`);

        // Address parsing - try to find it in footer
        // It's not clearly marked with a class, but usually in footer contact section.
        // Based on dump: <div class="col-md-3 col-sm-4 col-xs-12 fh5co-footer-link">... address text ...</div>
        // It might be hard to get exact address without better selectors, so we'll skip address overwrite for now 
        // unless we find a specific pattern. The user provided phone number is different than footer anyway.

        return { vehicles };

    } catch (error) {
        console.error("Error scraping website:", error.message);
        return { vehicles: [] };
    }
}

module.exports = { scrapeBusinessData };
