const fs = require('fs');
const { exec } = require('child_process');
const { db } = require('../database/init');
const crypto = require('crypto');

function generateXrayConfig() {
    return new Promise((resolve) => {
        db.all(`
            SELECT i.*, u.username, r.*
            FROM inbounds i
            JOIN users u ON i.user_id = u.id
            LEFT JOIN reality_settings r ON i.id = r.inbound_id
            WHERE i.is_active = 1 AND u.is_active = 1 AND i.protocol IN ('vless', 'mtproto')
        `, (err, inbounds) => {
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
                const settings = JSON.parse(inbound.settings || '{}');
                const stream = JSON.parse(inbound.stream_settings || '{}');
                const tls = JSON.parse(inbound.tls_settings || '{}');
                
                const port = inbound.port || (basePort + index);
                const network = inbound.network_type || 'ws';

                console.log(`🔌 Configuring ${inbound.protocol} on port ${port} (${network})`);
                console.log(`📋 TLS Settings:`, JSON.stringify(tls, null, 2));

                if (inbound.protocol === 'vless') {
                    // تنظیمات پایه VLESS
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

                    // ============ تنظیمات TLS با ALPN ============
                    if (tls.security === 'tls') {
                        console.log('🔒 Applying TLS settings with ALPN...');
                        inboundConfig.streamSettings.security = 'tls';
                        inboundConfig.streamSettings.tlsSettings = {
                            serverName: tls.tlsSettings?.serverName || domain,
                            fingerprint: tls.tlsSettings?.fingerprint || 'chrome',
                            alpn: tls.tlsSettings?.alpn || ['h2', 'http/1.1'], // مهم!
                            allowInsecure: false
                        };
                        console.log(`  ✅ TLS configured with SNI: ${inboundConfig.streamSettings.tlsSettings.serverName}`);
                        console.log(`  📋 ALPN: ${inboundConfig.streamSettings.tlsSettings.alpn.join(', ')}`);
                    }

                    // ============ تنظیمات Reality با ALPN ============
                    if (tls.security === 'reality') {
                        console.log('🔐 Applying Reality settings with ALPN...');
                        
                        const realitySettings = {
                            publicKey: inbound.public_key || '',
                            privateKey: inbound.private_key || '',
                            shortIds: (inbound.short_ids || '').split(',').filter(s => s.trim()),
                            serverName: inbound.server_name || 'cloudflare.com',
                            fingerprint: inbound.fingerprint || 'chrome',
                            alpn: inbound.alpn || ['h2', 'http/1.1'], // مهم!
                            show: true
                        };
                        
                        // اگر publicKey خالی بود، تولید کن
                        if (!realitySettings.publicKey) {
                            try {
                                const { execSync } = require('child_process');
                                // تولید کلید با Xray
                                const privKey = execSync('xray x25519').toString().trim();
                                const pubKey = execSync('xray x25519').toString().trim();
                                realitySettings.privateKey = privKey;
                                realitySettings.publicKey = pubKey;
                            } catch (e) {
                                // اگر Xray نبود، از کلیدهای ساختگی استفاده کن
                                realitySettings.privateKey = crypto.randomBytes(32).toString('base64');
                                realitySettings.publicKey = crypto.randomBytes(32).toString('base64');
                            }
                        }
                        
                        inboundConfig.streamSettings.security = 'reality';
                        inboundConfig.streamSettings.realitySettings = realitySettings;
                        console.log(`  ✅ Reality configured with SNI: ${realitySettings.serverName}`);
                        console.log(`  📋 ALPN: ${realitySettings.alpn.join(', ')}`);
                        console.log(`  📋 Public Key: ${realitySettings.publicKey.substring(0, 20)}...`);
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
                console.log('📋 Inbounds count:', config.inbounds.length);
                
                config.inbounds.forEach((inbound, i) => {
                    console.log(`  ${i+1}. Port: ${inbound.port}, Protocol: ${inbound.protocol}, Network: ${inbound.streamSettings?.network || 'tcp'}, Security: ${inbound.streamSettings?.security || 'none'}`);
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
            console.log('📋 Command:', cmd);
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Xray error:', stderr || error.message);
                } else {
                    console.log('✅ Xray started successfully with ALPN support');
                    if (stdout) console.log('📋 Output:', stdout);
                    if (stderr) console.log('⚠️ Stderr:', stderr);
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
            const alpn = inbound.streamSettings?.tlsSettings?.alpn || 
                        inbound.streamSettings?.realitySettings?.alpn || 'not set';
            console.log(`  ${i+1}. Port: ${inbound.port}, Protocol: ${inbound.protocol}, Security: ${security}, ALPN: ${alpn}`);
        });
    } catch (error) {
        console.error('❌ Error reading config:', error);
    }
}

module.exports = { generateXrayConfig, startXray, restartXray, testConfig };