FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built application
COPY dist ./dist

# Create logs directory
RUN mkdir -p logs

# Expose service port
EXPOSE 3006

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3006/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Run the application
CMD ["node", "dist/index.js"]
