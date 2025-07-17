import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { tcp } from '@libp2p/tcp';
import { createHash, sign, verify } from 'crypto';
import { pipe } from 'it-pipe';
import { createLibp2p } from 'libp2p';
import { fromString, toString } from 'uint8arrays';

export class PBFTRelayer {
    constructor(config) {
        this.config = config;
        this.node = null;
        this.peers = new Set();
        this.view = 0;
        this.sequenceNumber = 0;
        this.lastExecuted = 0;
        this.pendingOperations = new Map();
        this.prepares = new Map();
        this.commits = new Map();
        this.signatures = new Map();
    }

    async initialize() {
        this.node = await createLibp2p({
            addresses: { listen: [`/ip4/127.0.0.1/tcp/${this.config.port}`] },
            transports: [tcp()],
            connectionEncrypters: [noise()],
            streamMuxers: [yamux()],
            transportManager: { faultTolerance: 'NO_FATAL' }
        });

        await this.node.start();
        console.log(`PBFT Relayer ${this.config.nodeIndex} started on port ${this.config.port}`);

        this.node.handle('/pbft/1.0.0', async ({ stream }) => {
            await pipe(stream.source, async (source) => {
                for await (const msg of source) {
                    const message = JSON.parse(toString(msg));
                    await this.handleMessage(message);
                }
            });
        });
    }

    isPrimary() {
        return this.view % this.config.totalNodes === this.config.nodeIndex;
    }

    async handleMessage(message) {
        console.log(`PBFTRelayer ${this.config.nodeIndex} received ${message.type} for digest ${message.digest}`);
        switch (message.type) {
            case 'pre-prepare':
                await this.handlePrePrepare(message);
                break;
            case 'prepare':
                await this.handlePrepare(message);
                break;
            case 'commit':
                await this.handleCommit(message);
                break;
            case 'view-change':
                await this.handleViewChange(message);
                break;
            case 'new-view':
                await this.handleNewView(message);
                break;
            default:
                console.warn(`PBFTRelayer ${this.config.nodeIndex} received unknown message type: ${message.type}`);
        }
    }

    async handlePrePrepare(message) {
        if (!this.isPrimary() && this.verifyPrePrepare(message)) {
            const key = `${message.view}-${message.sequence}-${message.digest}`;
            this.pendingOperations.set(key, message.operation);
            this.signatures.set(key, new Map([[message.nodeIndex, message.signature]]));
            console.log(`PBFTRelayer ${this.config.nodeIndex} stored operation for key=${key}`);

            const operationStr = JSON.stringify(message.operation, Object.keys(message.operation).sort());
            const signature = sign(null, Buffer.from(operationStr), this.config.privateKey);
            const prepareMessage = {
                type: 'prepare',
                view: message.view,
                sequence: message.sequence,
                digest: message.digest,
                nodeIndex: this.config.nodeIndex,
                signature: signature.toString('hex')
            };
            await this.broadcast(prepareMessage);
        } else {
            console.warn(`PBFTRelayer ${this.config.nodeIndex} rejected pre-prepare: primary=${this.isPrimary()}, valid=${this.verifyPrePrepare(message)}`);
        }
    }

    async handlePrepare(message) {
        const key = `${message.view}-${message.sequence}-${message.digest}`;
        if (!this.prepares.has(key)) {
            this.prepares.set(key, new Set());
        }
        if (!this.signatures.has(key)) {
            this.signatures.set(key, new Map());
        }
        this.prepares.get(key).add(message.nodeIndex);
        this.signatures.get(key).set(message.nodeIndex, message.signature);

        if (this.prepares.get(key).size >= this.config.quorum) {
            console.log(`PBFTRelayer ${this.config.nodeIndex} reached prepare quorum for key=${key}`);
            const operationStr = JSON.stringify(this.pendingOperations.get(key), Object.keys(this.pendingOperations.get(key)).sort());
            const signature = sign(null, Buffer.from(operationStr), this.config.privateKey);
            const commitMessage = {
                type: 'commit',
                view: message.view,
                sequence: message.sequence,
                digest: message.digest,
                nodeIndex: this.config.nodeIndex,
                signature: signature.toString('hex')
            };
            await this.broadcast(commitMessage);
        }
    }

    async handleCommit(message) {
        const key = `${message.view}-${message.sequence}-${message.digest}`;
        if (!this.commits.has(key)) {
            this.commits.set(key, new Set());
        }
        if (!this.signatures.has(key)) {
            this.signatures.set(key, new Map());
        }
        this.commits.get(key).add(message.nodeIndex);
        this.signatures.get(key).set(message.nodeIndex, message.signature);

        if (this.commits.get(key).size >= this.config.quorum) {
            console.log(`PBFTRelayer ${this.config.nodeIndex} reached commit quorum for key=${key}`);
            const operation = this.pendingOperations.get(key);
            if (operation) {
                const signatures = this.signatures.get(key);
                let validSignatures = 0;
                const operationStr = JSON.stringify(operation, Object.keys(operation).sort());
                for (const [nodeIndex, sig] of signatures) {
                    const publicKey = this.config.publicKeys[parseInt(nodeIndex)];
                    if (verify(null, Buffer.from(operationStr), publicKey, Buffer.from(sig, 'hex'))) {
                        validSignatures++;
                    }
                }
                if (validSignatures >= this.config.quorum) {
                    await this.executeOperation(operation);
                    this.lastExecuted = message.sequence;
                    this.pendingOperations.delete(key);
                    this.prepares.delete(key);
                    this.commits.delete(key);
                    this.signatures.delete(key);
                } else {
                    console.error(`PBFTRelayer ${this.config.nodeIndex} insufficient valid signatures for key=${key}`);
                }
            } else {
                console.error(`PBFTRelayer ${this.config.nodeIndex} no operation found for key=${key}`);
            }
        }
    }

    async handleViewChange(message) {
        if (message.newView > this.view) {
            this.view = message.newView;
            console.log(`PBFTRelayer ${this.config.nodeIndex} updated to view ${this.view}`);
            if (this.isPrimary()) {
                const newViewMessage = {
                    type: 'new-view',
                    newView: this.view,
                    nodeIndex: this.config.nodeIndex
                };
                await this.broadcast(newViewMessage);
            }
        }
    }

    async handleNewView(message) {
        if (message.newView === this.view) {
            console.log(`PBFTRelayer ${this.config.nodeIndex} confirmed new view ${this.view}`);
            for (const [key, operation] of this.pendingOperations) {
                if (this.isPrimary()) {
                    const [view, sequence] = key.split('-').map(Number);
                    const operationStr = JSON.stringify(operation, Object.keys(operation).sort());
                    const signature = sign(null, Buffer.from(operationStr), this.config.privateKey);
                    const prePrepareMessage = {
                        type: 'pre-prepare',
                        view,
                        sequence,
                        digest: operation.operationId,
                        operation,
                        nodeIndex: this.config.nodeIndex,
                        signature: signature.toString('hex')
                    };
                    await this.broadcast(prePrepareMessage);
                }
            }
        }
    }

    async broadcast(message) {
        console.log(`PBFTRelayer ${this.config.nodeIndex} broadcasting ${message.type} for digest=${message.digest || 'unknown'}`);
        for (const peer of this.peers) {
            try {
                const stream = await this.node.dialProtocol(peer, '/pbft/1.0.0');
                await pipe([fromString(JSON.stringify(message))], stream.sink);
                await stream.close();
                console.log(`PBFTRelayer ${this.config.nodeIndex} sent ${message.type} to ${peer}`);
            } catch (err) {
                console.warn(`PBFTRelayer ${this.config.nodeIndex} failed to send ${message.type} to peer ${peer}:`, err.message);
            }
        }
    }

    verifyPrePrepare(message) {
        if (message.view !== this.view || message.sequence <= this.lastExecuted) {
            console.warn(`PBFTRelayer ${this.config.nodeIndex} pre-prepare validation failed: view=${message.view}, expected=${this.view}, sequence=${message.sequence}, lastExecuted=${this.lastExecuted}`);
            return false;
        }
        const operationStr = JSON.stringify(message.operation, Object.keys(message.operation).sort());
        const computedDigest = createHash('sha256').update(operationStr).digest('hex');
        if (computedDigest !== message.digest) {
            console.warn(`PBFTRelayer ${this.config.nodeIndex} digest mismatch: computed=${computedDigest}, received=${message.digest}`);
            return false;
        }
        const publicKey = this.config.publicKeys[message.nodeIndex];
        return verify(null, Buffer.from(operationStr), publicKey, Buffer.from(message.signature, 'hex'));
    }

    async executeOperation(operation) {
        console.log(`PBFTRelayer ${this.config.nodeIndex} executed operation: ${JSON.stringify(operation)}`);
        if (this.config.executeOperation) {
            await this.config.executeOperation(operation);
        }
    }

    async addPeer(peerId) {
        this.peers.add(peerId);
        console.log(`PBFTRelayer ${this.config.nodeIndex} added peer: ${peerId}`);
    }

    async stop() {
        if (this.node) {
            await this.node.stop();
            console.log(`PBFTRelayer ${this.config.nodeIndex} stopped`);
        }
    }
}