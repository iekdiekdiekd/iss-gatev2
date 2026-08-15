const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db } = require('../database/init');

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    console.log('🔐 Login attempt:', username);
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            console.log('❌ User not found:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            console.log('❌ Invalid password for:', username);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // ذخیره در session
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Session error' });
            }
            console.log('✅ Login successful:', username);
            console.log('🔑 Session ID:', req.session.id);
            console.log('👤 User ID:', req.session.userId);
            
            res.json({
                success: true,
                user: { id: user.id, username: user.username }
            });
        });
    });
});

router.post('/logout', (req, res) => {
    const username = req.session.username;
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout error' });
        }
        console.log('👋 Logout:', username);
        res.json({ success: true });
    });
});

router.get('/session', (req, res) => {
    console.log('🔍 Session check:', {
        id: req.session.id,
        userId: req.session.userId,
        username: req.session.username,
        cookie: req.session.cookie
    });
    
    if (req.session.userId) {
        res.json({ 
            authenticated: true, 
            username: req.session.username,
            userId: req.session.userId
        });
    } else {
        res.json({ authenticated: false });
    }
});

module.exports = router;