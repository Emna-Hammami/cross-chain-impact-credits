import { generateKeyPairSync } from 'crypto';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';

async function promptOverwrite() {
    return new Promise((resolve) => {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question('.env file already exists. Overwrite? (y/n): ', (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

async function generateRelayerKeys() {
    try {
        const keys = [];
        for (let i = 0; i < 3; i++) {
            const { publicKey, privateKey } = generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
            });
            console.log(`\nRelayer ${i} Private Key:\n${privateKey}`);
            console.log(`Relayer ${i} Public Key:\n${publicKey}`);
            keys.push({ publicKey, privateKey });
        }

        // Format keys for .env (escape newlines, wrap in quotes)
        const privateKeys = keys.map(k => `"${k.privateKey.replace(/\n/g, '\\n')}"`).join(',');
        const publicKeys = keys.map(k => `"${k.publicKey.replace(/\n/g, '\\n')}"`).join(',');

        // .env content
        const envContent = `RELAYER_PRIVATE_KEYS=${privateKeys}\nRELAYER_PUBLIC_KEYS=${publicKeys}\nRELAYER_PORTS=9000,9001,9002\nPBFT_PORTS=8000,8001,8002\n`;

        // Check if .env exists
        if (existsSync('.env')) {
            const shouldOverwrite = await promptOverwrite();
            if (!shouldOverwrite) {
                console.log('Aborted. Please manually update .env with the generated keys.');
                return;
            }
            unlinkSync('.env');
            console.log('Existing .env file removed.');
        }

        // Write to .env
        writeFileSync('.env', envContent, { encoding: 'utf8' });
        console.log('\nKeys written to .env file successfully.');
    } catch (err) {
        console.error('Error generating or writing keys:', err);
    }
}

generateRelayerKeys();