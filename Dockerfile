FROM node:18-alpine

# نصب Xray و ابزارهای دیباگ
RUN apk add --no-cache \
    wget unzip curl bash \
    net-tools iputils busybox-extras

# نصب Xray
RUN wget https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip && \
    unzip Xray-linux-64.zip -d /usr/local/bin/ && \
    rm Xray-linux-64.zip && \
    chmod +x /usr/local/bin/xray

# بررسی نصب Xray
RUN xray --version || echo "Xray installed"

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

# ایجاد پوشه‌ها
RUN mkdir -p sessions database logs /tmp /var/log/xray

EXPOSE 3000
EXPOSE 10086-10186

CMD ["bash", "start.sh"]