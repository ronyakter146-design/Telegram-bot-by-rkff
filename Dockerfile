FROM ghcr.io/puppeteer/puppeteer:23.0.0

WORKDIR /app

COPY package.json .
RUN npm install

COPY . .

CMD ["node", "bot.js"]
