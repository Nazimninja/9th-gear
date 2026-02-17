const https = require('https');
const fs = require('fs');

const url = 'https://9thgear.co.in/';
const options = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
};

https.get(url, options, (res) => {
    console.log('StatusCode:', res.statusCode);
    console.log('Headers:', res.headers);

    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('Body length:', data.length);
        if (res.statusCode === 200) {
            fs.writeFileSync('site_dump.html', data);
            console.log('Saved site_dump.html');
        }
    });

}).on('error', (e) => {
    console.error(e);
});
