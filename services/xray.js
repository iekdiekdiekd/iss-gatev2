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

            const basePort = parseInt(process.env.XRAY_BASE_PORT) || 10086;

            inbounds.forEach((inbound, index) => {
                const settings = JSON.parse(inbound.settings || '{}');
                const stream = JSON.parse(inbound.stream_settings || '{}');
                const tls = JSON.parse(inbound.tls_settings || '{}');
                const port = inbound.port || (basePort + index);
                const network = inbound.network_type || 'ws';

                console.log(`🔌 Configuring ${inbound.protocol} on port ${port} (${network})`);

                if (inbound.protocol === 'vless') {
                    // ساخت inbound کامل
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
                        console.log(`  ✅ WS Settings: path=${inboundConfig.streamSettings.wsSettings.path}, host=${inboundConfig.streamSettings.wsSettings.headers.Host}`);
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
                            allowInsecure: false
                        };
                        console.log(`  🔒 TLS enabled: ${inboundConfig.streamSettings.tlsSettings.serverName}`);
                    }

                    // Reality
                    if (tls.security === 'reality') {
                        inboundConfig.streamSettings.security = 'reality';
                        inboundConfig.streamSettings.realitySettings = {
                            publicKey: inbound.public_key || '',
                            privateKey: inbound.private_key || '',
                            shortIds: (inbound.short_ids || '').split(',').filter(s => s),
                            serverName: inbound.server_name || 'cloudflare.com',
                            fingerprint: inbound.fingerprint || 'chrome',
                            show: true
                        };
                        console.log(`  🔐 Reality enabled: ${inboundConfig.streamSettings.realitySettings.serverName}`);
                    }

                    config.inbounds.push(inboundConfig);
                    console.log(`✅ VLESS+${network} configured on port ${port}`);

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
                console.log(`✅ Test VLESS config added on port ${basePort} with UUID: ${testUUID}`);
            }

            // ذخیره کانفیگ
            const configPath = '/tmp/xray-config.json';
            try {
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                console.log('✅ Xray config saved to:', configPath);
                console.log('📋 Inbounds count:', config.inbounds.length);
                
                // نمایش خلاصه
                config.inbounds.forEach((inbound, i) => {
                    console.log(`  ${i+1}. Port: ${inbound.port}, Protocol: ${inbound.protocol}, Network: ${inbound.streamSettings?.network || 'tcp'}`);
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

        // Stop existing Xray
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
            
            // اجرا با لاگ کامل
            const cmd = `xray -config ${configPath} -format json`;
            console.log('📋 Command:', cmd);
            
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Xray error:', stderr || error.message);
                } else {
                    console.log('✅ Xray started successfully');
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
            console.log(`  ${i+1}. Port: ${inbound.port}, Protocol: ${inbound.protocol}, Network: ${inbound.streamSettings?.network || 'tcp'}`);
        });
    } catch (error) {
        console.error('❌ Error reading config:', error);
    }
}

module.exports = { generateXrayConfig, startXray, restartXray, testConfig };