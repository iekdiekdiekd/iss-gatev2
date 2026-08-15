require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { db, initDatabase } = require('./database/init');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const inboundRoutes = require('./routes/inbounds');
const subscriptionRoutes = require('./routes/subscription');
const { generateXrayConfig, startXray } = require('./services/xray');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: process.env.JWT_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/inbounds', inboundRoutes);
app.use('/sub', subscriptionRoutes);

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

initDatabase();
setTimeout(() => { generateXrayConfig(); startXray(); }, 1000);

app.listen(PORT, () => {
    console.log(`🚀 ISSPanel running on port ${PORT}`);
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || `localhost:${PORT}`;
    console.log(`🔗 Admin Panel: http://${domain}/admin`);
    console.log(`📊 Dashboard: http://${domain}/dashboard`);
});

module.exports = { app, db };