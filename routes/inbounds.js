const express = require('express');
const router = express.Router();
const { db } = require('../database/init');
const { authMiddleware } = require('../middleware/auth');
const { generateXrayConfig, restartXray, testConfig } = require('../services/xray');
const { generateWireGuardKeys, setupWireGuard, generateWireGuardLink } = require('../services/wireguard');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');

// تابع ساخت لینک VLESS
function buildVlessLink({ uuid, domain, port, network, streamSettings, tlsSettings, realityEnabled, tlsEnabled, name }) {
    let link = `vless://${uuid}@${domain}:${port}`;
    const params = ['encryption=none'];
    
    if (realityEnabled) {
        params.push('security=reality');
        if (streamSettings.realitySettings) {
            params.push(`pbk=${encodeURIComponent(streamSettings.realitySettings.publicKey || '')}`);
            params.push(`sid=${encodeURIComponent(streamSettings.realitySettings.shortIds?.[0] || '')}`);
            params.push(`sni=${encodeURIComponent(streamSettings.realitySettings.serverName || domain)}`);
            params.push(`fp=${encodeURIComponent(streamSettings.realitySettings.fingerprint || 'chrome')}`);
            if (streamSettings.realitySettings.alpn) {
                params.push(`alpn=${encodeURIComponent(streamSettings.realitySettings.alpn.join(','))}`);
            }
        }
    } else if (tlsEnabled) {
        params.push(`security=${tlsSettings.security || 'tls'}`);
        if (tlsSettings.tlsSettings) {
            params.push(`sni=${encodeURIComponent(tlsSettings.tlsSettings.serverName || domain)}`);
            params.push(`fp=${encodeURIComponent(tlsSettings.tlsSettings.fingerprint || 'chrome')}`);
            if (tlsSettings.tlsSettings.alpn) {
                params.push(`alpn=${encodeURIComponent(tlsSettings.tlsSettings.alpn.join(','))}`);
            }
        }
    } else {
        params.push('security=none');
    }
    
    params.push(`type=${network}`);
    
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
    console.log('📋 GET /api/inbounds - Fetching all inbounds');
    
    db.all(`
        SELECT i.*, u.username as owner_username 
        FROM inbounds i
        LEFT JOIN users u ON i.user_id = u.id
        ORDER BY i.id DESC
    `, (err, inbounds) => {
        if (err) {
            console.error('❌ Error fetching inbounds:', err);
            return res.status(500).json({ error: err.message });
        }
        console.log(`✅ Found ${inbounds.length} inbounds`);
        res.json(inbounds);
    });
});

// POST create inbound
router.post('/', authMiddleware, (req, res) => {
    console.log('📝 POST /api/inbounds - Creating new inbound');
    console.log('📋 Request body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { 
            user_id, name, protocol, network_type, port,
            path, host,
            tls_enabled, tls_type, tls_server_name, tls_fingerprint, tls_alpn,
            reality_enabled, reality_public_key, reality_private_key,
            reality_short_ids, reality_server_name, reality_fingerprint, reality_alpn,
            xhttp_host, xhttp_path, xhttp_mode,
            secret, address, allowed_ips, client_address, flow
        } = req.body;
        
        // Validation
        if (!user_id) {
            console.error('❌ Missing user_id');
            return res.status(400).json({ error: 'user_id is required' });
        }
        if (!name) {
            console.error('❌ Missing name');
            return res.status(400).json({ error: 'name is required' });
        }
        if (!protocol) {
            console.error('❌ Missing protocol');
            return res.status(400).json({ error: 'protocol is required' });
        }
        if (!port) {
            console.error('❌ Missing port');
            return res.status(400).json({ error: 'port is required' });
        }
        
        if (!['vless', 'mtproto', 'wireguard'].includes(protocol)) {
            console.error('❌ Invalid protocol:', protocol);
            return res.status(400).json({ error: 'Invalid protocol' });
        }
        
        let settings = {};
        let streamSettings = {};
        let tlsSettings = {};
        let link = '';
        const domain = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
        
        console.log(`🔧 Configuring ${protocol} for user ${user_id}`);
        
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
                const alpn = tls_alpn ? tls_alpn.split(',').map(s => s.trim()) : ['h2', 'http/1.1'];
                tlsSettings = {
                    security: tls_type || 'tls',
                    tlsSettings: {
                        serverName: tls_server_name || domain,
                        fingerprint: tls_fingerprint || 'chrome',
                        alpn: alpn,
                        allowInsecure: false
                    }
                };
                streamSettings = { 
                    ...streamSettings, 
                    security: tls_type || 'tls', 
                    tlsSettings: tlsSettings.tlsSettings 
                };
                console.log(`  🔒 TLS enabled with ALPN: ${alpn.join(', ')}`);
            }
            
            // Reality
            if (reality_enabled === 'true' || reality_enabled === true) {
                const shortIds = reality_short_ids || crypto.randomBytes(8).toString('hex');
                const privateKey = reality_private_key || crypto.randomBytes(32).toString('base64');
                const alpn = reality_alpn ? reality_alpn.split(',').map(s => s.trim()) : ['h2', 'http/1.1'];
                
                streamSettings = {
                    ...streamSettings,
                    security: 'reality',
                    realitySettings: {
                        publicKey: reality_public_key || '',
                        privateKey: privateKey,
                        shortIds: [shortIds],
                        serverName: reality_server_name || 'cloudflare.com',
                        fingerprint: reality_fingerprint || 'chrome',
                        alpn: alpn,
                        show: true
                    }
                };
                
                req.realitySettings = {
                    public_key: reality_public_key || '',
                    private_key: privateKey,
                    short_ids: shortIds,
                    server_name: reality_server_name || 'cloudflare.com',
                    fingerprint: reality_fingerprint || 'chrome',
                    alpn: alpn.join(',')
                };
                console.log(`  🔐 Reality enabled with ALPN: ${alpn.join(', ')}`);
            }
            
            // ساخت لینک
            link = buildVlessLink({
                uuid, domain, port, network, streamSettings, tlsSettings,
                realityEnabled: reality_enabled === 'true' || reality_enabled === true,
                tlsEnabled: tls_enabled === 'true' || tls_enabled === true,
                name
            });
            
            console.log('🔗 Generated VLESS link:', link.substring(0, 100) + '...');
            
        } else if (protocol === 'mtproto') {
            const mtprotoSecret = secret || crypto.randomBytes(16).toString('hex');
            settings = { secret: mtprotoSecret };
            link = `tg://proxy?server=${domain}&port=${port}&secret=${mtprotoSecret}`;
            console.log('🔗 Generated MTProto link');
            
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
        
        const tlsJSON = JSON.stringify(tlsSettings || {});
        const streamJSON = JSON.stringify(streamSettings || {});
        
        console.log('💾 Saving to database...');
        
        db.run(
            `INSERT INTO inbounds (user_id, name, protocol, network_type, port, settings, stream_settings, tls_settings)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user_id, name, protocol, network_type || 'ws', port, JSON.stringify(settings), streamJSON, tlsJSON],
            function(err) {
                if (err) {
                    console.error('❌ Database error:', err);
                    return res.status(500).json({ error: 'Database error: ' + err.message });
                }
                
                const inboundId = this.lastID;
                console.log(`✅ Inbound created with ID: ${inboundId}`);
                
                // ذخیره Reality settings
                if (protocol === 'vless' && req.realitySettings) {
                    const r = req.realitySettings;
                    console.log('💾 Saving Reality settings...');
                    db.run(
                        `INSERT OR REPLACE INTO reality_settings 
                         (inbound_id, public_key, private_key, short_ids, server_name, fingerprint, alpn)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [inboundId, r.public_key, r.private_key, r.short_ids, r.server_name, r.fingerprint, r.alpn],
                        function(err) {
                            if (err) {
                                console.error('❌ Error saving Reality settings:', err);
                            } else {
                                console.log('✅ Reality settings saved');
                            }
                        }
                    );
                }
                
                // راه‌اندازی Xray یا WireGuard
                if (protocol === 'wireguard') {
                    setupWireGuard({ id: inboundId, name, port, settings });
                } else {
                    console.log('🔄 Regenerating Xray config...');
                    generateXrayConfig().then(() => {
                        restartXray();
                        setTimeout(() => testConfig(), 2000);
                    }).catch(err => {
                        console.error('❌ Error generating Xray config:', err);
                    });
                }
                
                res.status(201).json({
                    id: inboundId,
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
    } catch (error) {
        console.error('❌ Unhandled error in POST /api/inbounds:', error);
        console.error('Stack trace:', error.stack);
        return res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// DELETE inbound
router.delete('/:id', authMiddleware, (req, res) => {
    console.log(`🗑️ DELETE /api/inbounds/${req.params.id}`);
    
    db.get('SELECT * FROM inbounds WHERE id = ?', [req.params.id], (err, inbound) => {
        if (err) {
            console.error('❌ Error finding inbound:', err);
            return res.status(500).json({ error: err.message });
        }
        if (!inbound) {
            console.log('❌ Inbound not found');
            return res.status(404).json({ error: 'Not found' });
        }
        
        if (inbound.protocol === 'wireguard') {
            exec(`wg-quick down ${inbound.name}`, () => {
                const configPath = `/etc/wireguard/${inbound.name}.conf`;
                if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
            });
        }
        
        db.run('DELETE FROM inbounds WHERE id = ?', [req.params.id], function(err) {
            if (err) {
                console.error('❌ Error deleting inbound:', err);
                return res.status(500).json({ error: err.message });
            }
            console.log(`✅ Inbound ${req.params.id} deleted`);
            
            if (inbound.protocol !== 'wireguard') {
                generateXrayConfig().then(() => restartXray());
            }
            res.json({ success: true });
        });
    });
});

module.exports = router;