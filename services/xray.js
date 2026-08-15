const fs = require('fs');
const { exec } = require('child_process');
const { db } = require('../database/init');

function generateXrayConfig() {
    return new Promise((resolve) => {
        db.all(`
            SELECT i.*, u.username, r.*
            FROM inbounds i
            JOIN users u ON i.user_id = u.id
            LEFT JOIN reality_settings r ON i.id = r.inbound_id
            WHERE i.is_active = 1 AND u.is_active = 1 AND i.protocol IN ('vless', 'mtproto')
        `, (err, inbounds) => {
            if (err) { console.error('Error loading inbounds:', err); return resolve(); }
            
            const config = {
                log: { loglevel: 'warning' },
                inbounds: [],
                outbounds: [{ protocol: 'freedom', tag: 'direct' }, { protocol: 'blackhole', tag: 'block' }],
                routing: { rules: [{ type: 'field', outboundTag: 'block', ip: ['geoip:private'] }] }
            };
            
            const basePort = parseInt(process.env.XRAY_BASE_PORT) || 10086;
            
            inbounds.forEach((inbound, index) => {
                const settings = JSON.parse(inbound.settings || '{}');
                const stream = JSON.parse(inbound.stream_settings || '{}');
                const tls = JSON.parse(inbound.tls_settings || '{}');
                const port = inbound.port || (basePort + index);
                const network = inbound.network_type || 'ws';
                
                if (inbound.protocol === 'vless') {
                    const inboundConfig = {
                        port: port,
                        protocol: 'vless',
                        settings: {
                            clients: [{ id: settings.uuid, flow: settings.flow || 'xtls-rprx-vision' }],
                            decryption: 'none'
                        },
                        streamSettings: { network: network, ...stream }
                    };
                    
                    if (tls.security === 'reality') {
                        inboundConfig.streamSettings = {
                            ...inboundConfig.streamSettings,
                            security: 'reality',
                            realitySettings: {
                                publicKey: inbound.public_key || '',
                                privateKey: inbound.private_key || '',
                                shortIds: (inbound.short_ids || '').split(','),
                                serverName: inbound.server_name || '',
                                fingerprint: inbound.fingerprint || 'chrome',
                                show: true
                            }
                        };
                    } else if (tls.security === 'tls') {
                        inboundConfig.streamSettings = {
                            ...inboundConfig.streamSettings,
                            security: 'tls',
                            tlsSettings: {
                                serverName: tls.tlsSettings?.serverName || '',
                                fingerprint: tls.tlsSettings?.fingerprint || 'chrome',
                                allowInsecure: false
                            }
                        };
                    }
                    
                    config.inbounds.push(inboundConfig);
                } else if (inbound.protocol === 'mtproto') {
                    config.inbounds.push({
                        port: port,
                        protocol: 'mtproto',
                        settings: { clients: [{ secret: settings.secret }] }
                    });
                }
            });
            
            const configPath = '/tmp/xray-config.json';
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            console.log('✅ Xray config generated');
            resolve(configPath);
        });
    });
}

function startXray() {
    exec('which xray', (error) => {
        if (error) { console.log('⚠️ Xray not found. Mock mode.'); return; }
        exec('pkill xray || true', () => {
            exec('xray -config /tmp/xray-config.json', (error, stdout, stderr) => {
                if (error) console.error('❌ Xray error:', stderr);
                else console.log('✅ Xray started');
            });
        });
    });
}

function restartXray() { startXray(); }

module.exports = { generateXrayConfig, startXray, restartXray };