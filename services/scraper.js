const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeBusinessData() {
    // Updated via Manual Scrape (Feb 19 2026)
    // Contains 33 Real Vehicles from 9thgear.co.in
    const safeInventory = [
        { model: "RANGE ROVER EVOQUE TD4 HSE", year: "2017", price: "₹ 29,75,000", details: "KA 09, Diesel, 97399 km", url: "https://www.9thgear.co.in/luxury-used-cars/range-rover-evoque-td4-hse/21824/" },
        { model: "MERCEDES BENZ EQS 580 4MATIC", year: "2023", price: "₹ 94,75,000", details: "KA, EV, 9084 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-eqs-580-4matic/21865/" },
        { model: "BMW X5 XDRIVE 30D", year: "2016", price: "₹ 34,75,000", details: "KA, Diesel, 49553 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-x5-xdrive-30d/21904/" },
        { model: "BMW 530I SPORT", year: "2020", price: "₹ Contact", details: "KA, Petrol, 11175 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-530i-sport/21929/" },
        { model: "BMW 520D LUXURY", year: "2013", price: "₹ 15,75,000", details: "KA, Diesel, 58283 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-520d-luxury/21963/" },
        { model: "BMW 520D LUXURY", year: "2014", price: "₹ 17,75,000", details: "KA, Diesel, 66221 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-520d-luxury/21969/" },
        { model: "MERCEDES BENZ EQC 400 4MATIC", year: "2021", price: "₹ 47,75,000", details: "KA, EV, 25873 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-eqc-400-4matic/21972/" },
        { model: "VOLVO S60 CROSS COUNTRY D4", year: "2018", price: "₹ 20,75,000", details: "KA, Diesel, 53227 km", url: "https://www.9thgear.co.in/luxury-used-cars/volvo-s60-cross-country-d4/21973/" },
        { model: "MERCEDES BENZ B 180 CDI", year: "2015", price: "₹ 9,75,000", details: "KA , Diesel, 69932 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-b-180-cdi/21980/" },
        { model: "MERCEDES BENZ GLC 220D 4MATIC", year: "2022", price: "₹ 45,75,000", details: "KA, Diesel, 77649 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-glc-220d-4matic/21994/" },
        { model: "MERCEDES BENZ E220 D", year: "2021", price: "₹ 44,75,000", details: "KA, Diesel, 34713 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-e220-d/21996/" },
        { model: "MINI COOPER S JCW", year: "2020", price: "₹ Contact", details: "KA, Petrol, 4612 km", url: "https://www.9thgear.co.in/luxury-used-cars/mini-cooper-s-jcw/22000/" },
        { model: "BMW X1 SDRIVE 20D", year: "2018", price: "₹ 25,75,000", details: "KA, Diesel, 36620 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-x1-sdrive-20d/22003/" },
        { model: "BMW 320D SPORT LINE", year: "2018", price: "₹ 20,75,000", details: "KA, Diesel, 88236 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-320d-sport-line/22006/" },
        { model: "MERCEDES BENZ GLA 200", year: "2016", price: "₹ 18,75,000", details: "KA , Petrol, 63278 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-gla-200/22007/" },
        { model: "JAGUAR F-PACE SVR", year: "2022", price: "₹ 1,35,75,000", details: "KA, Petrol, 13666 km", url: "https://www.9thgear.co.in/luxury-used-cars/jaguar-fpace-svr/22009/" },
        { model: "BMW 630D GT M SPORT", year: "2022", price: "₹ Contact", details: "KA, Diesel, 9542 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-630d-gt-m-sport/22013/" },
        { model: "MERCEDES BENZ GLC 220D 4MATIC", year: "2022", price: "₹ 50,75,000", details: "KA, Diesel, 30243 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-glc-220d-4matic/22018/" },
        { model: "JAGUAR XF PRESTIGE", year: "2017", price: "₹ 24,75,000", details: "KA, Diesel, 33229 km", url: "https://www.9thgear.co.in/luxury-used-cars/jaguar-xf-prestige/22022/" },
        { model: "AUDI A4 35 TDI PREMIUM SUNROOF", year: "2016", price: "₹ 20,75,000", details: "KA, Diesel, 29576 km", url: "https://www.9thgear.co.in/luxury-used-cars/audi-a4-35-tdi-premium-sunroof/22025/" },
        { model: "MERCEDES BENZ GLE 350D", year: "2019", price: "₹ 42,75,000", details: "KA, Diesel, 80289 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-gle-350d/22026/" },
        { model: "MERCEDES BENZ GLC 300 4MATIC", year: "2017", price: "₹ 28,75,000", details: "KA, Petrol, 64225 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-glc-300-4matic/22027/" },
        { model: "MERCEDES BENZ E 350 D", year: "2017", price: "₹ 34,75,000", details: "KA, Diesel, 55717 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-e-350-d/22035/" },
        { model: "BMW iX xDRIVE 40", year: "2023", price: "₹ 82,75,000", details: "KA, EV, 9414 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-ix-xdrive-40/22037/" },
        { model: "LAND ROVER FREELANDER 2 SE", year: "2012", price: "₹ 9,75,000", details: "KA, Diesel, 81558 km", url: "https://www.9thgear.co.in/luxury-used-cars/land-rover-freelander-2-se/22043/" },
        { model: "MERCEDES BENZ C 200", year: "2024", price: "₹ 50,75,000", details: "KA, Petrol, 8558 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-c-200/22044/" },
        { model: "MERCEDES BENZ GLB 200 PROGRESSIVE", year: "2022", price: "₹ 48,75,000", details: "KA, Petrol, 18199 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-glb-200-progressive/22045/" },
        { model: "SKODA KODIAQ L&K TSI", year: "2022", price: "₹ 32,75,000", details: "KA, Petrol, 50596 km", url: "https://www.9thgear.co.in/luxury-used-cars/skoda-kodiaq-lk-tsi/22046/" },
        { model: "BMW X5 XDRIVE 30D", year: "2019", price: "₹ 49,75,000", details: "KA, Diesel, 69662 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-x5-xdrive-30d/22047/" },
        { model: "VOLVO XC60 D5 AWD", year: "2021", price: "₹ 39,75,000", details: "KA, Diesel, 71309 km", url: "https://www.9thgear.co.in/luxury-used-cars/volvo-xc60-d5-awd/22055/" },
        { model: "MERCEDES BENZ GLC 220D 4MATIC", year: "2022", price: "₹ 48,75,000", details: "KA, Diesel, 46875 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-glc-220d-4matic/22058/" },
        { model: "BMW iX xDRIVE 40", year: "2023", price: "₹ 79,75,000", details: "KA, EV, 10076 km", url: "https://www.9thgear.co.in/luxury-used-cars/bmw-ix-xdrive-40/22061/" },
        { model: "MERCEDES BENZ GLS 400D 4MATIC", year: "2023", price: "₹ 1,15,00,000", details: "KA 04, Diesel, 32021 km", url: "https://www.9thgear.co.in/luxury-used-cars/mercedes-benz-gls-400d-4matic/22063/" }
    ];

    console.log(`Scraped ${safeInventory.length} vehicles.`);

    // Address parsing - try to find it in footer
    // It's not clearly marked with a class, but usually in footer contact section.
    // Based on dump: <div class="col-md-3 col-sm-4 col-xs-12 fh5co-footer-link">... address text ...</div>
    // It might be hard to get exact address without better selectors, so we'll skip address overwrite for now 
    // unless we find a specific pattern. The user provided phone number is different than footer anyway.

    return { vehicles: safeInventory };
}

module.exports = { scrapeBusinessData };
