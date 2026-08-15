require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

// اطمینان از وجود پوشه دیتابیس
if (!fs.existsSync('./database')) {
    fs.mkdirSync('./database', { recursive: true });
}

const { db, initDatabase } = require('./database/init');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const inboundRoutes = require('./routes/inbounds');
const subscriptionRoutes = require('./routes/subscription');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session
app.use(session({
    secret: process.env.JWT_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
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
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Initialize database and start
console.log('📊 Initializing database...');
initDatabase();

// Start server
app.listen(PORT, () => {
    console.log(`🚀 ISSPanel running on port ${PORT}`);
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || `localhost:${PORT}`;
    console.log(`🔗 Admin Panel: http://${domain}/admin`);
    console.log(`📊 Dashboard: http://${domain}/dashboard`);
});

module.exports = { app, db };