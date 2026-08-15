const fs = require('fs');
const { exec } = require('child_process');
const { db } = require('../database/init');
const crypto = require('crypto');

// تابع کمکی برای بررسی وجود جدول
function tableExists(tableName) {
    return new Promise((resolve) => {
        db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            [tableName],
            (err, row) => {
                resolve(!err && row);
            }
        );
    });
}

function generateXrayConfig() {
    return new Promise(async (resolve) => {
        // بررسی وجود جدول reality_settings
        const hasRealityTable = await tableExists('reality_settings');
        
        let query = `
            SELECT i.*, u.username
            FROM inbounds i
            JOIN users u ON i.user_id = u.id
            WHERE i.is_active = 1 AND u.is_active = 1 AND i.protocol IN ('vless', 'mtproto')
        `;
        
        // اگر جدول reality_settings وجود داشت، JOIN کن
        if (hasRealityTable) {
            query = `
                SELECT i.*, u.username, r.*
                FROM inbounds i
                JOIN users u ON i.user_id = u.id
                LEFT JOIN reality_settings r ON i.id = r.inbound_id
                WHERE i.is_active = 1 AND u.is_active = 1 AND i.protocol IN ('vless', 'mtproto')
            `;
        }
        
        db.all(query, (err, inbounds) => {
            if (err) {
                console.error('❌ Error loading inbounds:', err);
                return resolve();
            }

            console.log(`📊 Found ${inbounds.length} active inbounds`);

            const domain = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
            const basePort = parseInt(process.env.XRAY_BASE_PORT) || 2096;
            
            const config = {
                log: {
                    loglevel: 'warning',
                    access: '/var/log/xray/access.log',
                    error: '/var/log/xray/error.log'
                },
                inbounds: [],
                outbounds: [
                    {
                        protocol: 'freedom',
                        tag: 'direct',
                        settings: {}
                    },
                    {
                        protocol: 'blackhole',
                        tag: 'block',
                        settings: {}
                    }
                ],
                routing: {
                    domainStrategy: 'AsIs',
                    rules: [
                        {
                            type: 'field',
                            outboundTag: 'block',
                            ip: ['geoip:private']
                        }
                    ]
                }
            };

            inbounds.forEach((inbound, index) => {
                try {
                    const settings = JSON.parse(inbound.settings || '{}');
                    const stream = JSON.parse(inbound.stream_settings || '{}');
                    const tls = JSON.parse(inbound.tls_settings || '{}');
                    
                    const port = inbound.port || (basePort + index);
                    const network = inbound.network_type || 'ws';

                    console.log(`🔌 Configuring ${inbound.protocol} on port ${port} (${network})`);

                    if (inbound.protocol === 'vless') {
                        const inboundConfig = {
                            port: port,
                            protocol: 'vless',
                            settings: {
                                clients: [{
                                    id: settings.uuid,
                                    flow: settings.flow || 'xtls-rprx-vision'
                                }],
                                decryption: 'none'
                            },
                            streamSettings: {
                                network: network,
                                security: 'none'
                            }
                        };

                        // تنظیمات شبکه
                        if (network === 'ws') {
                            inboundConfig.streamSettings.wsSettings = {
                                path: stream.wsSettings?.path || '/vless-ws',
                                headers: {
                                    Host: stream.wsSettings?.host || domain
                                }
                            };
                        } else if (network === 'xhttp') {
                            inboundConfig.streamSettings.xhttpSettings = {
                                path: stream.xhttpSettings?.path || '/vless-xhttp',
                                host: stream.xhttpSettings?.host || domain,
                                mode: stream.xhttpSettings?.mode || 'auto'
                            };
                        } else if (network === 'grpc') {
                            inboundConfig.streamSettings.grpcSettings = {
                                serviceName: stream.grpcSettings?.serviceName || 'vless-grpc'
                            };
                        }

                        // TLS
                        if (tls.security === 'tls') {
                            inboundConfig.streamSettings.security = 'tls';
                            inboundConfig.streamSettings.tlsSettings = {
                                serverName: tls.tlsSettings?.serverName || domain,
                                fingerprint: tls.tlsSettings?.fingerprint || 'chrome',
                                alpn: tls.tlsSettings?.alpn || ['h2', 'http/1.1'],
                                allowInsecure: false
                            };
                            console.log(`  ✅ TLS with ALPN: ${inboundConfig.streamSettings.tlsSettings.alpn.join(', ')}`);
                        }

                        // Reality (اگر جدول وجود داشته باشه)
                        if (tls.security === 'reality' && hasRealityTable) {
                            const realitySettings = {
                                publicKey: inbound.public_key || '',
                                privateKey: inbound.private_key || '',
                                shortIds: (inbound.short_ids || '').split(',').filter(s => s.trim()),
                                serverName: inbound.server_name || 'cloudflare.com',
                                fingerprint: inbound.fingerprint || 'chrome',
                                alpn: inbound.alpn ? inbound.alpn.split(',') : ['h2', 'http/1.1'],
                                show: true
                            };
                            
                            // تولید کلید اگر خالی بود
                            if (!realitySettings.publicKey) {
                                try {
                                    const { execSync } = require('child_process');
                                    const privKey = execSync('xray x25519').toString().trim();
                                    const pubKey = execSync('xray x25519').toString().trim();
                                    realitySettings.privateKey = privKey;
                                    realitySettings.publicKey = pubKey;
                                } catch (e) {
                                    realitySettings.privateKey = crypto.randomBytes(32).toString('base64');
                                    realitySettings.publicKey = crypto.randomBytes(32).toString('base64');
                                }
                            }
                            
                            inboundConfig.streamSettings.security = 'reality';
                            inboundConfig.streamSettings.realitySettings = realitySettings;
                            console.log(`  ✅ Reality with ALPN: ${realitySettings.alpn.join(', ')}`);
                        }

                        config.inbounds.push(inboundConfig);
                        console.log(`✅ ${inbound.protocol}+${network} configured on port ${port}`);

                    } else if (inbound.protocol === 'mtproto') {
                        config.inbounds.push({
                            port: port,
                            protocol: 'mtproto',
                            settings: {
                                clients: [{
                                    secret: settings.secret || crypto.randomBytes(16).toString('hex')
                                }]
                            },
                            streamSettings: {
                                network: 'tcp',
                                security: 'none'
                            }
                        });
                        console.log(`✅ MTProto configured on port ${port}`);
                    }
                } catch (error) {
                    console.error(`❌ Error configuring inbound ${inbound.id}:`, error.message);
                }
            });

            // اگر هیچ inboundی وجود نداشت، یک نمونه تستی اضافه کن
            if (config.inbounds.length === 0) {
                console.log('⚠️ No inbounds found, adding test config...');
                const testUUID = crypto.randomUUID();
                config.inbounds.push({
                    port: basePort,
                    protocol: 'vless',
                    settings: {
                        clients: [{ id: testUUID, flow: 'xtls-rprx-vision' }],
                        decryption: 'none'
                    },
                    streamSettings: {
                        network: 'ws',
                        security: 'none',
                        wsSettings: {
                            path: '/vless-test',
                            headers: { Host: domain }
                        }
                    }
                });
                console.log(`✅ Test VLESS config added on port ${basePort}`);
                console.log(`📋 Test UUID: ${testUUID}`);
            }

            // ذخیره کانفیگ
            const configPath = '/tmp/xray-config.json';
            try {
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                console.log('✅ Xray config saved to:', configPath);
                console.log(`📋 ${config.inbounds.length} inbounds configured`);
                
                config.inbounds.forEach((inbound, i) => {
                    const security = inbound.streamSettings?.security || 'none';
                    console.log(`  ${i+1}. Port: ${inbound.port}, Protocol: ${inbound.protocol}, Security: ${security}`);
                });
                
                resolve(configPath);
            } catch (error) {
                console.error('❌ Error saving config:', error);
                resolve();
            }
        });
    });
}

function startXray() {
    console.log('🔍 Checking Xray...');
    
    exec('which xray', (error, stdout) => {
        if (error || !stdout) {
            console.log('⚠️ Xray not found. Running in mock mode.');
            return;
        }

        console.log('✅ Xray found at:', stdout.trim());

        exec('pkill xray || true', () => {
            const configPath = '/tmp/xray-config.json';
            if (!fs.existsSync(configPath)) {
                console.log('⚠️ Config not found, generating...');
                generateXrayConfig().then(() => {
                    startXray();
                });
                return;
            }

            console.log('🚀 Starting Xray with config:', configPath);
            const cmd = `xray -config ${configPath} -format json`;
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Xray error:', stderr || error.message);
                } else {
                    console.log('✅ Xray started successfully with ALPN support');
                }
            });
        });
    });
}

function restartXray() {
    console.log('🔄 Restarting Xray...');
    startXray();
}

function testConfig() {
    const configPath = '/tmp/xray-config.json';
    if (!fs.existsSync(configPath)) {
        console.log('⚠️ No config file found');
        return;
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('📋 Current config summary:');
        console.log(`  Total inbounds: ${config.inbounds.length}`);
        config.inbounds.forEach((inbound, i) => {
            const security = inbound.streamSettings?.security || 'none';
            console.log(`  ${i+1}. Port: ${inbound.port}, Protocol: ${inbound.protocol}, Security: ${security}`);
        });
    } catch (error) {
        console.error('❌ Error reading config:', error);
    }
}

module.exports = { generateXrayConfig, startXray, restartXray, testConfig };