const fs = require('fs');
const { exec } = require('child_process');
const crypto = require('crypto');
const { generateKeyPair } = require('@stablelib/curve25519');

function generateWireGuardKeys() {
    try {
        const { execSync } = require('child_process');
        const privateKey = execSync('wg genkey').toString().trim();
        const publicKey = execSync(`echo "${privateKey}" | wg pubkey`).toString().trim();
        return { privateKey, publicKey };
    } catch (error) {
        const keyPair = generateKeyPair();
        return {
            privateKey: Buffer.from(keyPair.secretKey).toString('base64'),
            publicKey: Buffer.from(keyPair.publicKey).toString('base64')
        };
    }
}

function setupWireGuard(inbound) {
    const settings = inbound.settings || JSON.parse(inbound.settings || '{}');
    const keys = settings.keys || {};
    const wgConfig = `
[Interface]
PrivateKey = ${keys.privateKey}
Address = ${settings.address || '10.0.0.1/24'}
ListenPort = ${inbound.port}
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
PublicKey = ${keys.publicKey || ''}
AllowedIPs = ${settings.allowed_ips || '0.0.0.0/0'}
    `;
    try {
        const configPath = `/etc/wireguard/${inbound.name}.conf`;
        fs.writeFileSync(configPath, wgConfig);
        exec(`wg-quick up ${inbound.name}`, (error, stdout, stderr) => {
            if (error) console.error(`❌ WireGuard error:`, stderr);
            else console.log(`✅ WireGuard ${inbound.name} started on port ${inbound.port}`);
        });
    } catch (error) {
        console.log('⚠️ WireGuard setup failed (mock mode):', error.message);
    }
}

function restartWireGuard(inbound) {
    exec(`wg-quick down ${inbound.name}`, () => setupWireGuard(inbound));
}

function generateWireGuardLink(inbound, user) {
    const settings = inbound.settings || JSON.parse(inbound.settings || '{}');
    const domain = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
    const keys = settings.keys || {};
    return `
[Interface]
PrivateKey = ${settings.client_private_key || 'YOUR_PRIVATE_KEY'}
Address = ${settings.client_address || '10.0.0.2/32'}
DNS = 1.1.1.1

[Peer]
PublicKey = ${keys.publicKey || ''}
AllowedIPs = ${settings.allowed_ips || '0.0.0.0/0'}
Endpoint = ${domain}:${inbound.port}
PersistentKeepalive = 25
    `.trim();
}

module.exports = { generateWireGuardKeys, setupWireGuard, restartWireGuard, generateWireGuardLink };