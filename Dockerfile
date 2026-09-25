# Imagen oficial de Playwright: trae Chromium y todas sus dependencias del sistema.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=4321

# Se instalan también las devDependencies (vite, react, typescript) porque hacen
# falta para compilar el frontend; después se descartan.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

ENV NODE_ENV=production

# Persistencia de configs y resultados (montar un volumen en /app/data)
VOLUME ["/app/data"]
EXPOSE 4321

CMD ["npx", "tsx", "server/index.ts"]
