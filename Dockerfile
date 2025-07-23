FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json /app
RUN npm install --production --arch=x64 --platform=linux
COPY . /app
EXPOSE 3002
CMD ["npm", "start"]
