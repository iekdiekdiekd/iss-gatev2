const express = require('express');
const router = express.Router();
const { db } = require('../database/init');
const { authMiddleware } = require('../middleware/auth');
const { generateXrayConfig, restartXray, testConfig } = require('../services/xray');
const { generateWireGuardKeys, setupWireGuard, generateWireGuardLink } = require('../services/wireguard');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');

// تابع ساخت لینک VLESS صحیح
function buildVlessLink({ uuid, domain, port, network, streamSettings, tlsSettings, realityEnabled, tlsEnabled, name }) {
    let link = `vless://${uuid}@${domain}:${port}`;
    const params = [];
    
    // پارامترهای پایه
    params.push('encryption=none');
    
    // امنیت
    if (realityEnabled) {
        params.push('security=reality');
        if (streamSettings.realitySettings) {
            params.push(`pbk=${encodeURIComponent(streamSettings.realitySettings.publicKey || '')}`);
            params.push(`sid=${encodeURIComponent(streamSettings.realitySettings.shortIds?.[0] || '')}`);
            params.push(`sni=${encodeURIComponent(streamSettings.realitySettings.serverName || domain)}`);
            params.push(`fp=${encodeURIComponent(streamSettings.realitySettings.fingerprint || 'chrome')}`);
        }
    } else if (tlsEnabled) {
        params.push(`security=${tlsSettings.security || 'tls'}`);
        if (tlsSettings.tlsSettings) {
            params.push(`sni=${encodeURIComponent(tlsSettings.tlsSettings.serverName || domain)}`);
            params.push(`fp=${encodeURIComponent(tlsSettings.tlsSettings.fingerprint || 'chrome')}`);
        }
    } else {
        params.push('security=none');
    }
    
    // نوع شبکه
    params.push(`type=${network}`);
    
    // تنظیمات مخصوص شبکه
    if (network === 'ws') {
        const wsSettings = streamSettings.wsSettings || {};
        if (wsSettings.host) params.push(`host=${encodeURIComponent(wsSettings.host)}`);
        if (wsSettings.path) params.push(`path=${encodeURIComponent(wsSettings.path)}`);
    } else if (network === 'xhttp') {
        const xhttpSettings = streamSettings.xhttpSettings || {};
        if (xhttpSettings.host) params.push(`host=${encodeURIComponent(xhttpSettings.host)}`);
        if (xhttpSettings.path) params.push(`path=${encodeURIComponent(xhttpSettings.path)}`);
        if (xhttpSettings.mode) params.push(`mode=${encodeURIComponent(xhttpSettings.mode)}`);
    } else if (network === 'grpc') {
        const grpcSettings = streamSettings.grpcSettings || {};
        if (grpcSettings.serviceName) params.push(`serviceName=${encodeURIComponent(grpcSettings.serviceName)}`);
    }
    
    link += '?' + params.join('&');
    const configName = name + 
        (realityEnabled ? '-Reality' : '') +
        (tlsEnabled ? '-TLS' : '') +
        (network === 'ws' ? '-WS' : network === 'xhttp' ? '-XHTTP' : network === 'grpc' ? '-gRPC' : '-TCP');
    link += `#${encodeURIComponent(configName)}`;
    
    return link;
}

// GET all inbounds
router.get('/', authMiddleware, (req, res) => {
    db.all(`
        SELECT i.*, u.username as owner_username 
        FROM inbounds i
        LEFT JOIN users u ON i.user_id = u.id
        ORDER BY i.id DESC
    `, (err, inbounds) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(inbounds);
    });
});

// POST create inbound
router.post('/', authMiddleware, (req, res) => {
    const { 
        user_id, name, protocol, network_type, port,
        path, host,
        tls_enabled, tls_type, tls_server_name, tls_fingerprint,
        reality_enabled, reality_public_key, reality_private_key,
        reality_short_ids, reality_server_name, reality_fingerprint,
        xhttp_host, xhttp_path, xhttp_mode,
        secret, address, allowed_ips, client_address, flow
    } = req.body;
    
    if (!user_id || !name || !protocol || !port) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['vless', 'mtproto', 'wireguard'].includes(protocol)) {
        return res.status(400).json({ error: 'Invalid protocol' });
    }
    
    let settings = {};
    let streamSettings = {};
    let tlsSettings = {};
    let link = '';
    const domain = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
    
    if (protocol === 'vless') {
        const uuid = crypto.randomUUID();
        const network = network_type || 'ws';
        
        settings = { uuid, alterId: 0, flow: flow || 'xtls-rprx-vision' };
        
        // تنظیمات شبکه
        if (network === 'ws') {
            streamSettings = {
                network: 'ws',
                wsSettings: {
                    path: path || '/vless-ws',
                    host: host || domain,
                    headers: { Host: host || domain }
                }
            };
        } else if (network === 'xhttp') {
            streamSettings = {
                network: 'xhttp',
                xhttpSettings: {
                    path: xhttp_path || '/vless-xhttp',
                    host: xhttp_host || domain,
                    mode: xhttp_mode || 'auto'
                }
            };
        } else if (network === 'grpc') {
            streamSettings = {
                network: 'grpc',
                grpcSettings: {
                    serviceName: path || 'vless-grpc'
                }
            };
        } else {
            streamSettings = { network: 'tcp' };
        }
        
        // TLS
        if (tls_enabled === 'true' || tls_enabled === true) {
            tlsSettings = {
                security: tls_type || 'tls',
                tlsSettings: {
                    serverName: tls_server_name || domain,
                    fingerprint: tls_fingerprint || 'chrome',
                    allowInsecure: false
                }
            };
            streamSettings = { 
                ...streamSettings, 
                security: tls_type || 'tls', 
                tlsSettings: tlsSettings.tlsSettings 
            };
        }
        
        // Reality
        if (reality_enabled === 'true' || reality_enabled === true) {
            const shortIds = reality_short_ids || crypto.randomBytes(8).toString('hex');
            const privateKey = reality_private_key || crypto.randomBytes(32).toString('base64');
            
            streamSettings = {
                ...streamSettings,
                security: 'reality',
                realitySettings: {
                    publicKey: reality_public_key || '',
                    privateKey: privateKey,
                    shortIds: [shortIds],
                    serverName: reality_server_name || 'cloudflare.com',
                    fingerprint: reality_fingerprint || 'chrome',
                    show: true
                }
            };
            
            req.realitySettings = {
                public_key: reality_public_key || '',
                private_key: privateKey,
                short_ids: shortIds,
                server_name: reality_server_name || 'cloudflare.com',
                fingerprint: reality_fingerprint || 'chrome'
            };
        }
        
        // ساخت لینک
        link = buildVlessLink({
            uuid, domain, port, network, streamSettings, tlsSettings,
            realityEnabled: reality_enabled === 'true' || reality_enabled === true,
            tlsEnabled: tls_enabled === 'true' || tls_enabled === true,
            name
        });
        
        console.log('🔗 Generated VLESS link:', link);
        
    } else if (protocol === 'mtproto') {
        const mtprotoSecret = secret || crypto.randomBytes(16).toString('hex');
        settings = { secret: mtprotoSecret };
        link = `tg://proxy?server=${domain}&port=${port}&secret=${mtprotoSecret}`;
        console.log('🔗 Generated MTProto link:', link);
        
    } else if (protocol === 'wireguard') {
        const keys = generateWireGuardKeys();
        const clientPrivateKey = generateWireGuardKeys().privateKey;
        settings = {
            keys: { privateKey: keys.privateKey, publicKey: keys.publicKey },
            client_private_key: clientPrivateKey,
            address: address || '10.0.0.1/24',
            client_address: client_address || '10.0.0.2/32',
            allowed_ips: allowed_ips || '0.0.0.0/0'
        };
        link = generateWireGuardLink({ ...req.body, settings, name, port }, { username: 'user' });
        console.log('🔗 Generated WireGuard config');
    }
    
    // ذخیره در دیتابیس
    const tlsJSON = JSON.stringify(tlsSettings || {});
    const streamJSON = JSON.stringify(streamSettings || {});
    
    db.run(
        `INSERT INTO inbounds (user_id, name, protocol, network_type, port, settings, stream_settings, tls_settings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [user_id, name, protocol, network_type || 'ws', port, JSON.stringify(settings), streamJSON, tlsJSON],
        function(err) {
            if (err) {
                console.error('❌ DB Error:', err);
                return res.status(500).json({ error: err.message });
            }
            
            // ذخیره Reality settings
            if (protocol === 'vless' && req.realitySettings) {
                const r = req.realitySettings;
                db.run(
                    `INSERT OR REPLACE INTO reality_settings 
                     (inbound_id, public_key, private_key, short_ids, server_name, fingerprint)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [this.lastID, r.public_key, r.private_key, r.short_ids, r.server_name, r.fingerprint]
                );
            }
            
            // راه‌اندازی Xray یا WireGuard
            if (protocol === 'wireguard') {
                setupWireGuard({ id: this.lastID, name, port, settings });
            } else {
                generateXrayConfig().then(() => {
                    restartXray();
                    // تست کانفیگ
                    setTimeout(() => testConfig(), 1000);
                });
            }
            
            res.status(201).json({
                id: this.lastID,
                user_id,
                name,
                protocol,
                network_type: network_type || 'ws',
                port,
                link: link,
                settings: settings,
                stream_settings: streamSettings,
                tls_settings: tlsSettings
            });
        }
    );
});

// DELETE inbound
router.delete('/:id', authMiddleware, (req, res) => {
    db.get('SELECT * FROM inbounds WHERE id = ?', [req.params.id], (err, inbound) => {
        if (err || !inbound) return res.status(404).json({ error: 'Not found' });
        
        if (inbound.protocol === 'wireguard') {
            exec(`wg-quick down ${inbound.name}`, () => {
                const configPath = `/etc/wireguard/${inbound.name}.conf`;
                if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
            });
        }
        
        db.run('DELETE FROM inbounds WHERE id = ?', [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (inbound.protocol !== 'wireguard') {
                generateXrayConfig().then(() => restartXray());
            }
            res.json({ success: true });
        });
    });
});

module.exports = router;