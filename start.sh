#!/bin/bash
echo "🚀 Starting ISSPanel..."
export NODE_ENV=production
export PORT=${PORT:-3000}
export DB_PATH=${DB_PATH:-./database/iss.db}

mkdir -p /var/log/xray /etc/wireguard database logs

if [ ! -f "$DB_PATH" ]; then
    echo "📊 Creating database..."
    node scripts/setup.js
fi

echo "✅ Starting panel on port $PORT..."
echo "🔗 Admin Panel: https://${RAILWAY_PUBLIC_DOMAIN}/admin"
echo "📊 Dashboard: https://${RAILWAY_PUBLIC_DOMAIN}/dashboard"

node server.js