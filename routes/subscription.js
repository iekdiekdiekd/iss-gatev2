const express = require('express');
const router = express.Router();
const { db } = require('../database/init');

router.get('/:token', (req, res) => {
    const token = req.params.token;
    db.get('SELECT * FROM users WHERE subscription_token = ? AND is_active = 1', [token], (err, user) => {
        if (err || !user) return res.status(404).send('Invalid subscription token');
        if (user.expire_date && new Date(user.expire_date) < new Date()) return res.status(403).send('Subscription expired');
        if (user.traffic_used >= user.traffic_limit) return res.status(403).send('Traffic limit exceeded');
        
        db.all('SELECT * FROM inbounds WHERE user_id = ? AND is_active = 1', [user.id], (err, inbounds) => {
            if (err || inbounds.length === 0) return res.status(404).send('No active inbounds found');
            const domain = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
            let configs = [];
            
            inbounds.forEach(inbound => {
                const settings = JSON.parse(inbound.settings || '{}');
                const stream = JSON.parse(inbound.stream_settings || '{}');
                const tls = JSON.parse(inbound.tls_settings || '{}');
                const network = inbound.network_type || 'ws';
                
                if (inbound.protocol === 'vless') {
                    let link = '';
                    const security = tls.security || 'none';
                    if (network === 'ws') {
                        link = `vless://${settings.uuid}@${domain}:${inbound.port}?encryption=none&security=${security}&type=ws&host=${stream.wsSettings?.host || domain}&path=${encodeURIComponent(stream.wsSettings?.path || '/vless-ws')}#${encodeURIComponent(inbound.name)}`;
                    } else if (network === 'xhttp') {
                        link = `vless://${settings.uuid}@${domain}:${inbound.port}?encryption=none&security=${security}&type=xhttp&host=${stream.xhttpSettings?.host || domain}&path=${encodeURIComponent(stream.xhttpSettings?.path || '/vless-xhttp')}&mode=${stream.xhttpSettings?.mode || 'auto'}#${encodeURIComponent(inbound.name)}`;
                    }
                    configs.push(link);
                } else if (inbound.protocol === 'mtproto') {
                    configs.push(`tg://proxy?server=${domain}&port=${inbound.port}&secret=${settings.secret}`);
                } else if (inbound.protocol === 'wireguard') {
                    const wgConfig = `[Interface]\nPrivateKey = ${settings.client_private_key || 'YOUR_PRIVATE_KEY'}\nAddress = ${settings.client_address || '10.0.0.2/32'}\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ${settings.keys?.publicKey || ''}\nAllowedIPs = ${settings.allowed_ips || '0.0.0.0/0'}\nEndpoint = ${domain}:${inbound.port}\nPersistentKeepalive = 25`;
                    configs.push(`wireguard://${Buffer.from(wgConfig).toString('base64')}#${encodeURIComponent(inbound.name)}`);
                }
            });
            
            db.run('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
            res.set('Content-Type', 'text/plain; charset=utf-8');
            res.set('Subscription-Userinfo', `upload=0; download=${user.traffic_used}; total=${user.traffic_limit}; expire=${Math.floor(new Date(user.expire_date || Date.now() + 30*24*60*60*1000).getTime() / 1000)}`);
            res.send(configs.join('\n'));
        });
    });
});

module.exports = router;