# Imagen oficial de Playwright: trae Chromium y todas sus dependencias del sistema.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=4321

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build

# Persistencia de configs y resultados (montar un volumen en /app/data)
VOLUME ["/app/data"]
EXPOSE 4321

CMD ["npx", "tsx", "server/index.ts"]
