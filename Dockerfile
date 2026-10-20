FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

COPY package*.json ./

# Copy app source code
COPY ./ ./

# Expose port and start application
EXPOSE 3000
CMD npm run prod --loglevel=verbose