FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATABASE_FILE=/data/petition.sqlite
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
