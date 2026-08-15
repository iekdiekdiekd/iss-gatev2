#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');

console.log('🔧 Running setup...');

// ایجاد پوشه‌ها
['database', 'logs', '/tmp'].forEach(dir => {
    if (!fs.existsSync(dir)) { 
        try {
            fs.mkdirSync(dir, { recursive: true }); 
            console.log(`📁 Created: ${dir}`);
        } catch(e) {}
    }
});

const dbPath = path.join(__dirname, '../database/iss.db');

// حذف دیتابیس قدیمی اگر وجود داشته باشه (برای Railway)
// این کار رو نکنید اگر داده مهمی دارید
// fs.existsSync(dbPath) && fs.unlinkSync(dbPath);

const db = new sqlite3.Database(dbPath);

// اجرای همه دستورات در یک تراکنش
db.serialize(() => {
    // ایجاد جدول کاربران
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email TEXT,
            subscription_token TEXT UNIQUE NOT NULL,
            expire_date DATETIME,
            traffic_limit BIGINT DEFAULT 10737418240,
            traffic_used BIGINT DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME
        )
    `, (err) => {
        if (err) console.error('Error creating users table:', err.message);
    });

    // ایجاد جدول اینباندها
    db.run(`
        CREATE TABLE IF NOT EXISTS inbounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            protocol TEXT NOT NULL CHECK(protocol IN ('vless', 'mtproto', 'wireguard')),
            network_type TEXT CHECK(network_type IN ('ws', 'xhttp', 'tcp', 'grpc')),
            port INTEGER NOT NULL,
            settings TEXT,
            stream_settings TEXT,
            tls_settings TEXT,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `, (err) => {
        if (err) console.error('Error creating inbounds table:', err.message);
    });

    // ایجاد جدول Reality
    db.run(`
        CREATE TABLE IF NOT EXISTS reality_settings (
            inbound_id INTEGER PRIMARY KEY,
            public_key TEXT,
            private_key TEXT,
            short_ids TEXT,
            server_name TEXT,
            fingerprint TEXT,
            FOREIGN KEY(inbound_id) REFERENCES inbounds(id) ON DELETE CASCADE
        )
    `, (err) => {
        if (err) console.error('Error creating reality_settings table:', err.message);
    });

    // ایجاد کاربر ادمین
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const token = crypto.randomBytes(32).toString('hex');

    // بررسی وجود کاربر ادمین
    db.get('SELECT * FROM users WHERE username = ?', [adminUsername], (err, user) => {
        if (err) {
            console.error('Error checking admin user:', err.message);
            return;
        }
        
        if (!user) {
            const hashedPassword = bcrypt.hashSync(adminPassword, 10);
            db.run(
                'INSERT INTO users (username, password, subscription_token, is_active) VALUES (?, ?, ?, 1)',
                [adminUsername, hashedPassword, token],
                function(err) {
                    if (err) {
                        console.error('Error creating admin user:', err.message);
                    } else {
                        console.log(`✅ Admin created: ${adminUsername}`);
                        console.log(`🔑 Password: ${adminPassword}`);
                    }
                }
            );
        } else {
            console.log(`✅ Admin user already exists: ${adminUsername}`);
        }
    });
});

// بستن دیتابیس بعد از اتمام همه عملیات
db.close((err) => {
    if (err) {
        console.error('Error closing database:', err.message);
        process.exit(1);
    }
    console.log('✅ Setup completed successfully!');
    console.log(`📊 Database: ${dbPath}`);
    process.exit(0);
});

// هندل کردن خطاهای ناگهانی
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
    process.exit(1);
});