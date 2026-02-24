FROM node:20-slim

# 1. Install system dependencies for Chromium (Puppeteer)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libgbm-dev \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxkbcommon0 \
    libasound2 \
    libpangocairo-1.0-0 \
    libnspr4 \
    libnss3 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Tell Puppeteer to skip downloading Chrome — use system Chromium instead
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 3. Create app directory
WORKDIR /usr/src/app

# 4. Copy package files
COPY package*.json ./

# 5. Install Node dependencies
RUN npm install --omit=dev

# 6. Copy app source
COPY . .

# 7. Create data directory (Fixes ENOENT crash)
RUN mkdir -p /usr/src/app/data

# 8. Start the bot
CMD [ "node", "index.js" ]
