#!/bin/bash

echo "🚀 Starting ISSPanel on Railway..."

# تنظیم متغیرهای محیطی
export NODE_ENV=production
export PORT=${PORT:-3000}
export DB_PATH=${DB_PATH:-./database/iss.db}

# ایجاد پوشه‌های مورد نیاز
mkdir -p database logs
mkdir -p /tmp

# بررسی و ایجاد دیتابیس
if [ ! -f "$DB_PATH" ]; then
    echo "📊 Creating database..."
    node scripts/setup.js
fi

# نمایش اطلاعات
echo "✅ Starting panel on port $PORT..."
if [ ! -z "$RAILWAY_PUBLIC_DOMAIN" ]; then
    echo "🔗 Admin Panel: https://${RAILWAY_PUBLIC_DOMAIN}/admin"
    echo "📊 Dashboard: https://${RAILWAY_PUBLIC_DOMAIN}/dashboard"
fi

# اجرای پنل
node server.js