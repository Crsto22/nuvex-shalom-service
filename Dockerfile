FROM mcr.microsoft.com/playwright:v1.65.1-jammy

ENV TZ=America/Lima \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

# Se instalan devDependencies porque el build y las migraciones las necesitan
# (nest build, prisma migrate). El servicio corre con NODE_ENV=production.
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 4100

CMD ["node", "--enable-source-maps", "dist/apps/api/apps/api/src/main.js"]
