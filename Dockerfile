FROM node:18-alpine

RUN apk add --no-cache \
    wireguard-tools iptables wget unzip curl bash openssl tzdata python3 py3-pip

RUN wget https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip && \
    unzip Xray-linux-64.zip -d /usr/local/bin/ && \
    rm Xray-linux-64.zip && \
    chmod +x /usr/local/bin/xray

WORKDIR /app
COPY package*.json ./
COPY . .
RUN npm install
RUN node scripts/setup.js

EXPOSE 3000
EXPOSE 51820/udp
EXPOSE 10086-10186

CMD ["bash", "start.sh"]