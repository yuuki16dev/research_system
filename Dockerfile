# ======================================================================
# Research Studio — Cloud Production Dockerfile
# Optimized for Render Web Service, Railway, and Container PaaS
# Includes Headless Chromium & Japanese CJK Fonts for PDF/Excel generation
# ======================================================================

FROM node:20-bookworm-slim

# Install system dependencies, Chromium, and Japanese fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    fonts-ipafont-gothic \
    fonts-ipafont-mincho \
    fonts-freefont-ttf \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Set environment variables for Puppeteer / Chromium
ENV CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production \
    PORT=3939

# Copy package manifests first for caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy project source code
COPY . .

# Expose server port
EXPOSE 3939

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3939/api/health || exit 1

# Start production server
CMD ["node", "server/index.js"]
