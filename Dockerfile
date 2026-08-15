FROM node:18-alpine

# نصب ابزارهای مورد نیاز (بدون WireGuard در Railway)
RUN apk add --no-cache \
    wget \
    unzip \
    curl \
    bash \
    openssl \
    tzdata

# نصب Xray
RUN wget https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip && \
    unzip Xray-linux-64.zip -d /usr/local/bin/ && \
    rm Xray-linux-64.zip && \
    chmod +x /usr/local/bin/xray

WORKDIR /app

# کپی فایل‌ها
COPY package*.json ./
COPY . .

# نصب وابستگی‌ها (بدون پکیج مشکل‌دار)
RUN npm install --legacy-peer-deps

# اجرای اسکریپت setup
RUN node scripts/setup.js

# پورت‌های مورد نیاز
EXPOSE 3000
EXPOSE 10086-10186

# اسکریپت استارت
CMD ["bash", "start.sh"]