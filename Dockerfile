FROM node:20

# 1. Install dependencies for Chromium (Puppeteer)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Tell Puppeteer to skip downloading Chrome. We'll be using the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 3. Create app directory
WORKDIR /usr/src/app

# 4. Copy package files
COPY package*.json ./

# 5. Install dependencies
RUN npm install

# 6. Copy app source
COPY . .

# 7. Start the bot
CMD [ "node", "index.js" ]

