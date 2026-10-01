FROM node:18-slim

# Set environment variables

ENV NODE_ENV=production

ENV PORT=8081

# Set working directory

WORKDIR /app

# Copy package configurations

COPY package*.json /app/

# Install dependencies (only production-related ones)

RUN npm ci --only=production

# Copy application files

COPY . /app/

# Expose port for WS connection

EXPOSE 8081

# Run the voice pipeline server

CMD ["node", "index.js"]               
 