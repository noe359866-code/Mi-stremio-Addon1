# Addon de puntuaciones para Stremio — sin dependencias, imagen mínima.
#   docker build -t stremio-ratings ./ratings-addon
#   docker run --rm -p 7000:7000 -e TMDB_API_KEY=… stremio-ratings
FROM node:22-alpine

ENV NODE_ENV=production PORT=7000
WORKDIR /app

# no hay dependencias npm: sólo copiamos código
COPY package.json ./
COPY server.js ./
COPY src ./src

EXPOSE 7000
HEALTHCHECK --interval=60s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:7000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# sin useradd extra: node existe en la imagen oficial
USER node
CMD ["node", "server.js"]
