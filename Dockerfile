# Use a lightweight Node.js image
FROM node:20-slim

# Install system dependencies: python3 (required by yt-dlp) and curl (to download yt-dlp)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Ensure bin directory exists and pre-download the Linux yt-dlp binary
# This improves server startup times and prevents external API calls on boot
RUN mkdir -p /app/bin \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/bin/yt-dlp \
    && chmod a+rx /app/bin/yt-dlp

# Copy package files and install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy the remaining project files (including the committed arial.ttf font)
COPY . .

# Set default environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
