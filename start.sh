#!/bin/bash

echo "🚀 Starting ISSPanel on Railway..."

export NODE_ENV=production
export PORT=${PORT:-3000}
export DB_PATH=${DB_PATH:-./database/iss.db}

# ایجاد پوشه‌ها
mkdir -p database logs /tmp

echo "✅ Starting panel on port $PORT..."
if [ ! -z "$RAILWAY_PUBLIC_DOMAIN" ]; then
    echo "🔗 Admin Panel: https://${RAILWAY_PUBLIC_DOMAIN}/admin"
    echo "📊 Dashboard: https://${RAILWAY_PUBLIC_DOMAIN}/dashboard"
fi

# اجرای پنل
node server.js