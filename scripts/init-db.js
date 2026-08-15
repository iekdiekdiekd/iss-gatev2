#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');

console.log('🔧 Initializing database...');

const dbPath = path.join(__dirname, '../database/iss.db');

// اطمینان از وجود پوشه
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// حذف دیتابیس قدیمی (در صورت نیاز)
// if (fs.existsSync(dbPath)) {
//     fs.unlinkSync(dbPath);
//     console.log('🗑️ Old database removed');
// }

const db = new sqlite3.Database(dbPath);

// اجرای همه چیز در یک تراکنش
db.serialize(() => {
    // اجرای تراکنش
    db.run('BEGIN TRANSACTION');

    try {
        // جدول کاربران
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
        `);

        // جدول اینباندها
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
        `);

        // جدول Reality
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
        `);

        // ایجاد کاربر ادمین
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        
        db.get('SELECT * FROM users WHERE username = ?', [adminUsername], (err, row) => {
            if (err) throw err;
            
            if (!row) {
                const hashedPassword = bcrypt.hashSync(adminPassword, 10);
                const token = crypto.randomBytes(32).toString('hex');
                db.run(
                    'INSERT INTO users (username, password, subscription_token, is_active) VALUES (?, ?, ?, 1)',
                    [adminUsername, hashedPassword, token],
                    function(err) {
                        if (err) throw err;
                        console.log(`✅ Admin created: ${adminUsername}`);
                        console.log(`🔑 Password: ${adminPassword}`);
                    }
                );
            } else {
                console.log(`✅ Admin already exists: ${adminUsername}`);
            }
        });

        // commit تراکنش
        db.run('COMMIT');
        console.log('✅ Database initialized successfully');

    } catch (error) {
        console.error('❌ Error during setup:', error.message);
        db.run('ROLLBACK');
    }
});

// بستن دیتابیس
db.close((err) => {
    if (err) {
        console.error('❌ Error closing database:', err.message);
        process.exit(1);
    }
    console.log(`📊 Database: ${dbPath}`);
    process.exit(0);
});