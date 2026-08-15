const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db } = require('../database/init');

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        req.session.userId = user.id;
        req.session.username = user.username;
        res.json({ success: true, user: { id: user.id, username: user.username } });
    });
});

router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

router.get('/session', (req, res) => {
    if (req.session.userId) {
        res.json({ authenticated: true, username: req.session.username, userId: req.session.userId });
    } else {
        res.json({ authenticated: false });
    }
});

module.exports = router;