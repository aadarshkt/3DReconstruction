FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

ARG BACKEND_URL=http://host.docker.internal:8000
ARG AUTH_SERVICE_URL=http://auth_service:8002
ARG TOUR_SERVICE_URL=http://tour_service:8001
ENV BACKEND_URL=$BACKEND_URL
ENV AUTH_SERVICE_URL=$AUTH_SERVICE_URL
ENV TOUR_SERVICE_URL=$TOUR_SERVICE_URL

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["sh", "-c", "node -e \"const fs=require('fs'); ['server.js', '.next/routes-manifest.json', '.next/required-server-files.json'].forEach(f => { if(fs.existsSync(f)){ let c = fs.readFileSync(f, 'utf8'); if(process.env.BACKEND_URL) c = c.replaceAll('http://localhost:8000', process.env.BACKEND_URL); if(process.env.AUTH_SERVICE_URL) c = c.replaceAll('http://auth_service:8002', process.env.AUTH_SERVICE_URL); if(process.env.TOUR_SERVICE_URL) c = c.replaceAll('http://tour_service:8001', process.env.TOUR_SERVICE_URL); fs.writeFileSync(f, c); } });\" && node server.js"]
