import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { multiaddr } from '@multiformats/multiaddr';
import 'dotenv/config';
import { pipe } from 'it-pipe';
import { createLibp2p } from 'libp2p';
import { fromString, toString } from 'uint8arrays';
import { PBFTRelayer } from './pbft.js';

// Configuration
const config = {
    relayerPorts: process.env.RELAYER_PORTS?.split(',').map(port => parseInt(port.trim())) || [9000, 9001, 9002],
    pbftPorts: process.env.PBFT_PORTS?.split(',').map(port => parseInt(port.trim())) || [8000, 8001, 8002],
    totalNodes: 3,
    quorum: Math.floor((2 * 3) / 3) + 1,
    privateKeys: process.env.RELAYER_PRIVATE_KEYS?.split(',').map(key => key.replace(/\\n/g, '\n').replace(/^"|"$/g, '')) || [],
    publicKeys: process.env.RELAYER_PUBLIC_KEYS?.split(',').map(key => key.replace(/\\n/g, '\n').replace(/^"|"$/g, '')) || []
};

// Validate configuration
if (config.privateKeys.length !== 3 || config.publicKeys.length !== 3) {
    throw new Error('Missing or invalid RELAYER_PRIVATE_KEYS or RELAYER_PUBLIC_KEYS in .env');
}
if (config.relayerPorts.length !== 3) {
    throw new Error('Missing or invalid RELAYER_PORTS in .env');
}
config.privateKeys.forEach((key, i) => {
    if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
        throw new Error(`Invalid private key for Relayer ${i} in .env`);
    }
});
config.publicKeys.forEach((key, i) => {
    if (!key.includes('-----BEGIN PUBLIC KEY-----')) {
        throw new Error(`Invalid public key for Relayer ${i} in .env`);
    }
});

// polyfill customEvent for node.js
if (typeof global.CustomEvent === 'undefined') {
    global.CustomEvent = class CustomEvent extends Event {
        constructor(type, options = {}) {
            super(type, options);
            this.detail = options.detail || null;
        }
    };
    global.Event = class Event {
        constructor(type, options = {}) {
            this.type = type;
            this.bubbles = options.bubbles || false;
            this.cancelable = options.cancelable || false;
        }
    };
}

const relayerNodes = [];

export class Relayer {
    constructor(cfg) {
        this.config = cfg;
        this.node = null;
        this.peers = new Set();
        this.pbft = new PBFTRelayer({
            port: config.pbftPorts[cfg.nodeIndex],
            nodeIndex: cfg.nodeIndex,
            totalNodes: cfg.totalNodes,
            quorum: Math.floor((2 * config.totalNodes) / 3) + 1,
            privateKey: this.config.privateKey,
            publicKeys: this.config.publicKeys,
            executeOperation: this.executeOperation.bind(this)
        });
    }

    async initialize() {
        // Initialize PBFT
        await this.pbft.initialize();

        // Initialize libp2p node
        this.node = await createLibp2p({
            addresses: {
                listen: [`/ip4/127.0.0.1/tcp/${this.config.port}`]
            },
            transports: [tcp()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            transportManager: {
                faultTolerance: 'NO_FATAL' // Allow node to start despite address failures
            }
        });

        await this.node.start();
        console.log(`Relayer started on port ${this.config.port}`);

        // Handle incoming messages
        this.node.handle('/relayer/1.0.0', async ({ stream }) => {
            await pipe(
                stream.source,
                async (source) => {
                    for await (const msg of source) {
                        const message = JSON.parse(toString(msg));
                        await this.handleMessage(message);
                    }
                }
            );
        });
    }

    async handleMessage(message) {
        switch (message.type) {
            case 'operation':
                await this.handleOperation(message);
                break;
            case 'signature':
                await this.handleSignature(message);
                break;
        }
    }

    async handleOperation(message) {
        const { operationId, operation } = message;
        console.log(`Relayer ${this.config.nodeIndex} handling operation: ${operationId}`);
        
        // Store operation
        this.operations.set(operationId, operation);

        // If primary, start PBFT process
        if (this.pbft.isPrimary()) {
            const sequence = this.pbft.sequenceNumber++;
            const prePrepareMessage = {
                type: 'pre-prepare',
                view: this.pbft.view,
                sequence,
                digest: operationId,
                operation
            };
            console.log(`Relayer ${this.config.nodeIndex} broadcasting pre-prepare for ${operationId}`);
            await this.pbft.broadcast(prePrepareMessage);
        }
    }

    async executeOperation(operation) {
        console.log(`Relayer ${this.config.nodeIndex} executing operation: ${JSON.stringify(operation)}`);
        this.operations.delete(operation.operationId);
    }

    async broadcast(message) {
        for (const peer of this.peers) {
            try {
                const stream = await this.node.dialProtocol(peer, '/relayer/1.0.0');
                await pipe([fromString(JSON.stringify(message))], stream.sink);
                await stream.close();
            } catch (err) {
                console.warn(`Relayer ${this.config.nodeIndex} failed to broadcast to ${peer}:`, err.message);
            }
        }
    }

    async addPeer(peerId) {
        this.peers.add(peerId);
        await this.pbft.addPeer(peerId);
    }

    async stop() {
        await this.node.stop();
        await this.pbft.stop();
    }
}


/**
 * Starts a relayer instance and sets up event listeners for EVM and Massa events
 * @param {number} index - The index of the relayer (0, 1, or 2)
 * @returns {Promise<void>}
 */
async function startRelayer(index) {
    try {
        console.log(`Starting relayer ${index}...`);

        const relayer = new Relayer({
            port: config.relayerPorts[index],
            nodeIndex: index,
            totalNodes: config.privateKeys.length,
            quorum: config.quorum,
            privateKey: config.privateKeys[index],
            publicKeys: config.publicKeys
        });

        await relayer.initialize();
        console.log(`Relayer ${index} fully initialized`);

        const p2pNode = relayer.node;
        relayerNodes[index] = relayer;

        console.log(`Relayer ${index} started on port ${config.relayerPorts[index]}`);
        console.log(`Relayer ${index} multiaddrs:`, p2pNode.getMultiaddrs().map(m => m.toString()));
        console.log(`Relayer ${index} peerId:`, p2pNode.peerId.toString());

        // Connect to other relayers
        await new Promise(resolve => setTimeout(resolve, 5000));
        for (let i = 0; i < config.privateKeys.length; i++) {
            if (i !== index && relayerNodes[i]) {
                const otherPeerId = relayerNodes[i].node.peerId;
                const multiaddrStr = `/ip4/127.0.0.1/tcp/${config.relayerPorts[i]}/p2p/${otherPeerId.toString()}`;
                const ma = multiaddr(multiaddrStr);

                await p2pNode.peerStore.merge(otherPeerId, { multiaddrs: [ma] });
                console.log(`Relayer ${index} merged ${otherPeerId.toString()} to PeerStore with multiaddr: ${multiaddrStr}`);

                try {
                    console.log(`Relayer ${index} attempting to dial ${multiaddrStr}`);
                    const connection = await p2pNode.dial(ma);
                    console.log(`Relayer ${index} dialed Relayer ${i} on port ${config.relayerPorts[i]}, connection:`, {
                        id: connection.id,
                        remotePeer: connection.remotePeer.toString(),
                        remoteAddr: connection.remoteAddr.toString()
                    });
                } catch (err) {
                    console.warn(`Relayer ${index} failed to dial ${multiaddrStr}:`, err.message);
                }
            }
        }

        // Setup P2P message handler for consensus
        await p2pNode.handle('/bridge/1.0.0', async ({ stream }) => {
            let data = '';
            for await (const chunk of stream.source) {
                const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray(); 
                data += Buffer.from(bytes).toString();
            }
        });

    } catch (err) {
        console.error(`Relayer ${index} startup failed:`, err);
        throw err;
    }
}

async function main() {
    console.log('Starting 3-relayer network...');
    await Promise.all([startRelayer(0), startRelayer(1), startRelayer(2)]);
}

main();

process.on('SIGINT', () => {
    console.log('Shutting down relayer...');
    process.exit(0);
});