const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeBusinessData() {
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
