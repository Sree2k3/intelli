# ── Stage 1: Build ──────────────────────────────────────────────────────────

FROM node:18-alpine AS builder

WORKDIR /app

# Declare build arguments for Vite (baked in during build time)

ARG VITE_API_BASE_URL

ARG VITE_VOICE_SERVER_URL

ARG VITE_SCALOZ_URL

ARG VITE_SSO_MODE=true
ARG VITE_ENABLE_PAYLOAD_ENCRYPTION=true
ARG VITE_ENCRYPTION_KEY

# Set them as environment variables during build

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_VOICE_SERVER_URL=$VITE_VOICE_SERVER_URL
ENV VITE_SCALOZ_URL=$VITE_SCALOZ_URL
ENV VITE_SSO_MODE=$VITE_SSO_MODE
ENV VITE_ENABLE_PAYLOAD_ENCRYPTION=$VITE_ENABLE_PAYLOAD_ENCRYPTION
ENV VITE_ENCRYPTION_KEY=$VITE_ENCRYPTION_KEY

# Install dependencies

COPY package*.json /app/

RUN npm ci

# Copy code and build

COPY . /app/

RUN npm run build

# ── Stage 2: Serve ──────────────────────────────────────────────────────────

FROM nginx:alpine

# Remove default nginx config

RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx configuration with reverse proxy

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy Vite build artifacts

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
