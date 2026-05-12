FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy all website files
COPY . .

# Expose port
EXPOSE 8080

# Start Node.js server
CMD ["node", "server.js"]
