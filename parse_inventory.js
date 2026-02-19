const cheerio = require('cheerio');
const fs = require('fs');

const html = fs.readFileSync('site_dump_ps.html', 'utf8');
const $ = cheerio.load(html);
const vehicles = [];

$('.main-car').each((i, element) => {
    try {
        const name = $(element).find('h3 a').text().trim();
        let link = $(element).find('h3 a').attr('href');
        if (link && !link.startsWith('http')) link = `https://www.9thgear.co.in${link}`;

        const price = $(element).find('.posted_by').text().trim();
        const year = $(element).find('.comment').text().trim();

        // Extract details
        const details = [];
        $(element).find('.carbg').each((j, el) => {
            details.push($(el).text().trim());
        });

        if (name && price) {
            vehicles.push({
                model: name,
                year: year,
                price: price,
                details: details.join(', '),
                url: link
            });
        }
    } catch (err) {
        console.error("Skipping card:", err.message);
    }
});

console.log(JSON.stringify(vehicles, null, 2));
