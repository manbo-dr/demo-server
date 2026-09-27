FROM node:20-alpine

WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存
COPY package.json ./
RUN npm install --omit=dev

# 复制其余源码
COPY . .

EXPOSE 9000

CMD ["node", "server.js"]