FROM node:20-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy source
COPY . .

ENV NODE_ENV=production
# dotenv >=17 imprime "tips" autopromocionales (a veces apuntando a otros
# productos del mismo autor) en cada dotenv.config() — sin relación con
# seguridad, pero es ruido no pedido en los logs. Lo apagamos acá para no
# tener que tocar los ~19 call sites (app + scripts) uno por uno.
ENV DOTENV_CONFIG_QUIET=true

EXPOSE 3001

CMD ["node", "src/index.js"]
