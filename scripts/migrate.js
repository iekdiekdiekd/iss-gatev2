// scripts/migrate.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../database/iss.db');
const db = new sqlite3.Database(dbPath);

console.log('🔄 Running migration...');

db.serialize(() => {
    // ایجاد جدول reality_settings
    db.run(`
        CREATE TABLE IF NOT EXISTS reality_settings (
            inbound_id INTEGER PRIMARY KEY,
            public_key TEXT,
            private_key TEXT,
            short_ids TEXT,
            server_name TEXT,
            fingerprint TEXT,
            alpn TEXT,
            FOREIGN KEY(inbound_id) REFERENCES inbounds(id) ON DELETE CASCADE
        )
    `, (err) => {
        if (err) {
            console.error('❌ Migration failed:', err.message);
        } else {
            console.log('✅ reality_settings table created successfully');
        }
    });
});

db.close(() => {
    console.log('✅ Migration completed');
});