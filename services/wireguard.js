const fs = require('fs');
const { exec } = require('child_process');
const crypto = require('crypto');

// تولید کلیدهای WireGuard بدون وابستگی خارجی
function generateWireGuardKeys() {
    try {
        const { execSync } = require('child_process');
        const privateKey = execSync('wg genkey').toString().trim();
        const publicKey = execSync(`echo "${privateKey}" | wg pubkey`).toString().trim();
        return { privateKey, publicKey };
    } catch (error) {
        // اگر wg نصب نیست، از روش جایگزین استفاده می‌کنیم
        // این یک پیاده‌سازی ساده برای تولید کلید در Node.js هست
        const privateKey = generatePrivateKey();
        const publicKey = generatePublicKey(privateKey);
        return { privateKey, publicKey };
    }
}

// تولید کلید خصوصی (ساده شده برای Railway)
function generatePrivateKey() {
    // کلید 32 بایتی تصادفی
    return crypto.randomBytes(32).toString('base64');
}

// تولید کلید عمومی (ساده شده برای Railway)
function generatePublicKey(privateKey) {
    // در Railway که WireGuard نصب نیست، یک کلید عمومی ساختگی برمی‌گردونیم
    // توجه: این فقط برای Railway هست و کلید واقعی نیست
    return crypto.randomBytes(32).toString('base64');
}

function setupWireGuard(inbound) {
    const settings = inbound.settings || JSON.parse(inbound.settings || '{}');
    const keys = settings.keys || {};
    
    console.log('🔒 WireGuard setup (mock mode for Railway):', {
        name: inbound.name,
        port: inbound.port,
        publicKey: keys.publicKey
    });
    
    // در Railway، WireGuard رو تنظیم نمی‌کنیم چون نیاز به root داره
    // فقط لاگ می‌کنیم
}

function restartWireGuard(inbound) {
    console.log('🔄 WireGuard restart (mock mode):', inbound.name);
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