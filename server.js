require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// اطمینان از وجود پوشه‌ها
if (!fs.existsSync('./database')) {
    fs.mkdirSync('./database', { recursive: true });
}
if (!fs.existsSync('./sessions')) {
    fs.mkdirSync('./sessions', { recursive: true });
}

const { db, initDatabase } = require('./database/init');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const inboundRoutes = require('./routes/inbounds');
const subscriptionRoutes = require('./routes/subscription');
const { generateXrayConfig, startXray, testConfig } = require('./services/xray');

const app = express();
const PORT = process.env.PORT || 3000;

// Session
const FileStore = require('session-file-store')(session);

app.use(helmet({ 
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false 
}));
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    store: new FileStore({
        path: './sessions',
        ttl: 86400,
        retries: 0
    }),
    secret: process.env.JWT_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    },
    name: 'isspanel.sid'
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/inbounds', inboundRoutes);
app.use('/sub', subscriptionRoutes);

// Serve HTML
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(), 
        timestamp: new Date().toISOString(),
        xray: fs.existsSync('/tmp/xray-config.json') ? 'configured' : 'not_configured'
    });
});

// Test endpoint برای بررسی Xray
app.get('/test-xray', (req, res) => {
    exec('ps aux | grep xray | grep -v grep', (error, stdout) => {
        res.json({
            running: !error && stdout.length > 0,
            output: stdout || 'Not running',
            config_exists: fs.existsSync('/tmp/xray-config.json')
        });
    });
});

// اضافه کنید به server.js
app.get('/debug-config', (req, res) => {
    try {
        const config = fs.readFileSync('/tmp/xray-config.json', 'utf8');
        res.json(JSON.parse(config));
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Initialize
console.log('📊 Initializing database...');
initDatabase();

// Start Xray after setup
setTimeout(async () => {
    console.log('🚀 Generating Xray config...');
    await generateXrayConfig();
    console.log('🚀 Starting Xray...');
    startXray();
    setTimeout(() => testConfig(), 2000);
}, 3000);

app.listen(PORT, () => {
    console.log(`🚀 ISSPanel running on port ${PORT}`);
    const domain = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
    console.log(`🔗 Admin Panel: http://${domain}/admin`);
    console.log(`📊 Dashboard: http://${domain}/dashboard`);
    console.log(`🔍 Test Xray: http://${domain}/test-xray`);
});

module.exports = { app, db };