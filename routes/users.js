const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db } = require('../database/init');
const { authMiddleware } = require('../middleware/auth');
const { generateToken } = require('../database/init');

router.get('/', authMiddleware, (req, res) => {
    db.all(`
        SELECT id, username, email, expire_date, traffic_limit, traffic_used, 
               is_active, created_at, last_seen, subscription_token
        FROM users ORDER BY id DESC
    `, (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users);
    });
});

router.post('/', authMiddleware, (req, res) => {
    const { username, password, email, expire_date, traffic_limit } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    const hashedPassword = bcrypt.hashSync(password, 10);
    const token = generateToken();
    const trafficLimit = traffic_limit || 10737418240;
    
    db.run(
        `INSERT INTO users (username, password, email, expire_date, traffic_limit, subscription_token)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [username, hashedPassword, email, expire_date, trafficLimit, token],
        function(err) {
            if (err) return res.status(400).json({ error: 'Username already exists' });
            res.status(201).json({ id: this.lastID, username, email, subscription_token: token, traffic_limit: trafficLimit });
        }
    );
});

router.get('/:id', authMiddleware, (req, res) => {
    db.get(`SELECT id, username, email, expire_date, traffic_limit, traffic_used, 
               is_active, created_at, last_seen, subscription_token FROM users WHERE id = ?`,
        [req.params.id], (err, user) => {
            if (err || !user) return res.status(404).json({ error: 'User not found' });
            res.json(user);
        }
    );
});

router.put('/:id', authMiddleware, (req, res) => {
    const { email, expire_date, traffic_limit, is_active } = req.body;
    const updates = [], params = [];
    if (email) { updates.push('email = ?'); params.push(email); }
    if (expire_date) { updates.push('expire_date = ?'); params.push(expire_date); }
    if (traffic_limit) { updates.push('traffic_limit = ?'); params.push(traffic_limit); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    db.run(query, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

router.post('/:id/reset-traffic', authMiddleware, (req, res) => {
    db.run('UPDATE users SET traffic_used = 0 WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

router.delete('/:id', authMiddleware, (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

module.exports = router;