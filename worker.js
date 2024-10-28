import fetch from 'node-fetch';
import { parentPort, workerData } from 'worker_threads';
import { fromBase64 } from '@cosmjs/encoding';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { keccak_256 } from '@noble/hashes/sha3';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bech32 } from 'bech32';

// can add additional endpoints to this array, may need to adjust concurrency if not adding your own here
const apiEndpoints = [
        'http://tasty.seipex.fi:1317'
];

// find pubkey (if exists) from on-chain query via native (sei1..) wallet address
async function fetchPubKey(address, endpoint) {
    const url = `${endpoint}/cosmos/auth/v1beta1/accounts/${address}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP status ${response.status}`);
        }
        const data = await response.json();
        if (data.account && data.account.pub_key && data.account.pub_key.key) {
            return data.account.pub_key.key;
        } else {
            return null;
        }
    } catch (error) {
        console.error(`[Worker] Failed to fetch pubkey for ${address}: ${error.message}`);
        return null;
    }
}

// generate evm address from pubkey
function generateAddresses(pubKeyBase64) {
    const publicKeyCompressed = fromBase64(pubKeyBase64);
    const sha256Digest = sha256(publicKeyCompressed);
    const ripemd160Digest = ripemd160(sha256Digest);
    const fiveBitArray = convertBits(ripemd160Digest, 8, 5, true);
    const bech32Address = bech32.encode('sei', fiveBitArray);

    const publicKeyUncompressed = secp256k1.ProjectivePoint.fromHex(publicKeyCompressed).toRawBytes(false).slice(1);
    const keccakHash = keccak_256(publicKeyUncompressed);
    const ethAddress = '0x' + Buffer.from(keccakHash.slice(-20)).toString('hex');

    return { bech32Address, ethAddress };
}

async function processBatch(batch) {
    const results = [];
    for (const address of batch) {
        const endpoint = apiEndpoints[batch.indexOf(address) % apiEndpoints.length];
        const pubKey = await fetchPubKey(address, endpoint);
        if (pubKey) {
            const { ethAddress } = generateAddresses(pubKey);
            results.push({ walletAddress: address, pubKey, ethAddress });
        } else {
            parentPort.postMessage({ type: 'fetch_failed', walletAddress: address });
        }
    }
    parentPort.postMessage({ type: 'db_update_completed', batch: results });
}

processBatch(workerData.tasks).then(() => {
    console.log(`[Worker] Batch processing completed.`);
    process.exit(0);
});

function convertBits(data, fromBits, toBits, pad) {
    let acc = 0;
    let bits = 0;
    const result = [];
    const maxv = (1 << toBits) - 1;
    for (const value of data) {
        acc = (acc << fromBits) | value;
        bits += fromBits;
        while (bits >= toBits) {
            bits -= toBits;
            result.push((acc >> bits) & maxv);
        }
    }
    if (pad) {
        if (bits > 0) {
            result.push((acc << (toBits - bits)) & maxv);
        }
    } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
        throw new Error('Unable to convert bits');
    }
    return result;
}
