const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'iss.db');
const db = new sqlite3.Database(dbPath);

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function initDatabase() {
    console.log('📊 Initializing database...');
    
    db.serialize(() => {
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
        `, (err) => {
            if (err) console.error('Error creating users table:', err.message);
        });

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
        `, (err) => {
            if (err) console.error('Error creating inbounds table:', err.message);
        });

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
        `, (err) => {
            if (err) console.error('Error creating reality_settings table:', err.message);
        });

        // ایجاد کاربر ادمین
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        
        db.get('SELECT * FROM users WHERE username = ?', [adminUsername], (err, user) => {
            if (err) {
                console.error('Error checking admin:', err.message);
                return;
            }
            
            if (!user) {
                const hashedPassword = bcrypt.hashSync(adminPassword, 10);
                const token = generateToken();
                db.run(
                    'INSERT INTO users (username, password, subscription_token, is_active) VALUES (?, ?, ?, 1)',
                    [adminUsername, hashedPassword, token],
                    function(err) {
                        if (err) {
                            console.error('Error creating admin:', err.message);
                        } else {
                            console.log(`✅ Admin created: ${adminUsername}`);
                            console.log(`🔑 Password: ${adminPassword}`);
                        }
                    }
                );
            } else {
                console.log(`✅ Admin exists: ${adminUsername}`);
            }
        });
    });
}

module.exports = { db, initDatabase, generateToken };