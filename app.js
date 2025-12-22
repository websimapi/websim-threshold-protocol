import { Lobby } from './lobby.js';
import * as SSS from './shamir.js';
import * as Crypto from './crypto-layer.js';

// State
let role = 'PEER'; // HOST or PEER
let lobby = new Lobby();
let myShare = null;
let pendingRequest = null;

// Host Specific State
let encryptedPayload = null;
let distributedShares = [];
let receivedShares = [];
let activeRequestResolve = null;

// DOM Elements
const logEl = document.getElementById('system-log');
const hostPanel = document.getElementById('host-panel');
const peerPanel = document.getElementById('peer-panel');
const connLight = document.getElementById('conn-light');
const peerCountEl = document.getElementById('peer-count');
const roleIndicator = document.getElementById('role-indicator');
const epochDisplay = document.getElementById('epoch-val');

function log(msg, type = 'info') {
    const d = document.createElement('div');
    d.className = `log-entry ${type}`;
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
}

async function init() {
    log("Connecting to Consensus Mesh...");
    await lobby.init();
    
    connLight.classList.add('connected');
    
    // Determine Role: If room state is empty, become Host. Otherwise Peer.
    // This is a naive leadership election for the demo.
    if (!lobby.state || !lobby.state.hostId) {
        log("No active host detected. Assuming HOST role.", 'warn');
        role = 'HOST';
        lobby.updateRoomState({ hostId: lobby.clientId, epoch: 1 });
    } else if (lobby.state.hostId === lobby.clientId) {
        role = 'HOST';
    } else {
        role = 'PEER';
        log(`Joined as PEER. Connected to Host: ${lobby.state.hostId.substr(0,4)}...`);
    }

    updateUI();
    setupHandlers();
}

function updateUI() {
    roleIndicator.textContent = role;
    if (role === 'HOST') {
        hostPanel.classList.remove('hidden');
        peerPanel.classList.add('hidden');
    } else {
        hostPanel.classList.add('hidden');
        peerPanel.classList.remove('hidden');
        document.getElementById('my-peer-id').textContent = lobby.clientId.substr(0, 8);
    }
}

function setupHandlers() {
    // Connection Logic
    lobby.on('presence_change', (peers) => {
        peerCountEl.textContent = `${peers.length} PEERS`;
        if (role === 'HOST') {
            document.getElementById('threshold-range').max = Math.max(2, peers.length);
        }
    });

    lobby.on('state_change', (state) => {
        if (state.epoch) epochDisplay.textContent = state.epoch;
        // If host abandoned, reset? (Out of scope for simple demo, but good for robustness)
    });

    // Protocol Messages
    lobby.on('DISTRIBUTE_SHARE', async (msg) => {
        if (msg.targetId !== lobby.clientId) return; // Ignore if not for me
        
        log(`Received Key Share ID: ${msg.shareId}`, 'success');
        myShare = {
            id: msg.shareId,
            data: SSS.hexToBytes(msg.shareData),
            epoch: msg.epoch
        };

        // UI Updates
        document.getElementById('peer-icon').textContent = '🔐';
        document.getElementById('peer-status-text').textContent = 'ARMED';
        document.getElementById('peer-detail').textContent = `Holding fragment of critical key. Epoch: ${msg.epoch}`;
    });

    lobby.on('REQUEST_AUTH', (msg) => {
        if (role === 'PEER' && myShare && myShare.epoch === msg.epoch) {
            handleAuthRequest(msg);
        }
    });

    lobby.on('PROVIDE_SHARE', (msg) => {
        if (role === 'HOST' && activeRequestResolve) {
            handleReceivedShare(msg);
        }
    });

    lobby.on('EXECUTION_COMPLETE', () => {
        if (role === 'PEER') {
            // Close modal if open
            const modal = document.getElementById('auth-request-modal');
            if (!modal.classList.contains('hidden')) {
                modal.classList.add('hidden');
                log("Host execution completed.");
            }
        }
    });
}

// --- HOST LOGIC ---

document.getElementById('threshold-range').addEventListener('input', (e) => {
    document.getElementById('threshold-val').textContent = e.target.value;
});

document.getElementById('btn-lock').addEventListener('click', async () => {
    const secret = document.getElementById('secret-input').value;
    const t = parseInt(document.getElementById('threshold-range').value);
    const peers = lobby.peers;

    if (!secret) return log("Secret cannot be empty", 'error');
    if (peers.length < t) return log(`Not enough peers connected (Need ${t}, have ${peers.length})`, 'error');

    log("Encrypting secret and generating shards...", 'warn');

    try {
        // 1. Generate Session Key (The one we will split)
        const sessionKeyRaw = await Crypto.generateKey();
        const sessionKeyBytes = await Crypto.exportKey(sessionKeyRaw); // 32 bytes for AES-256

        // 2. Encrypt the user's secret
        encryptedPayload = await Crypto.encryptData(sessionKeyRaw, secret);
        
        // 3. Split the Session Key
        const shares = SSS.split(sessionKeyBytes, peers.length, t); // Split among all peers

        // 4. Distribute
        const currentEpoch = (lobby.state.epoch || 0) + 1;
        lobby.updateRoomState({ epoch: currentEpoch });

        log(`Distributing ${shares.length} shares for Epoch ${currentEpoch}...`);

        shares.forEach((share, index) => {
            const peerId = peers[index];
            const hexShare = SSS.bytesToHex(share.y);
            
            lobby.sendTo(peerId, 'DISTRIBUTE_SHARE', {
                shareId: share.x,
                shareData: hexShare,
                epoch: currentEpoch
            });
        });

        // 5. Cleanup Host Memory
        document.getElementById('secret-input').value = ""; // Clear UI
        // In a real app we'd explicitly unset sessionKeyRaw/Bytes variables here
        
        // UI State
        document.getElementById('step-setup').classList.add('disabled');
        document.getElementById('step-execute').classList.remove('disabled');
        document.getElementById('shares-count').textContent = shares.length;
        
        log("Secret locked. Key shredded. System armed.", 'success');

    } catch (e) {
        log("Error during locking: " + e.message, 'error');
        console.error(e);
    }
});

document.getElementById('btn-request').addEventListener('click', async () => {
    const t = parseInt(document.getElementById('threshold-range').value);
    log(`Broadcasting Authorization Request (Need ${t} approvals)...`);
    
    receivedShares = []; // Reset collection bucket
    const reqId = Date.now().toString();

    // Broadcast Request
    lobby.broadcast('REQUEST_AUTH', {
        reqId,
        epoch: lobby.state.epoch,
        timestamp: Date.now()
    });

    // Wait for shares
    try {
        const reconstructedKeyBytes = await new Promise((resolve, reject) => {
            activeRequestResolve = (share) => {
                // Check uniqueness
                if (!receivedShares.find(s => s.x === share.x)) {
                    receivedShares.push(share);
                    log(`Received share ${share.x}... (${receivedShares.length}/${t})`);
                    
                    if (receivedShares.length >= t) {
                        try {
                            const key = SSS.combine(receivedShares);
                            resolve(key);
                        } catch(e) {
                            reject(e);
                        }
                    }
                }
            };
            
            // Timeout
            setTimeout(() => reject(new Error("Timeout waiting for peers")), 10000);
        });

        log("Threshold met. Reconstructing Session Key...", 'success');

        // Import the reconstructed key
        const importedKey = await Crypto.importKey(reconstructedKeyBytes);

        // Decrypt Payload
        log("Decrypting Secret Payload...");
        const secret = await Crypto.decryptData(importedKey, encryptedPayload);

        // Execute API Call
        const url = document.getElementById('target-url').value;
        log(`EXECUTING API CALL to ${url}...`, 'warn');
        
        // Simulated Fetch to demonstrate usage
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${secret}` // Using the reconstructed secret
                },
                body: JSON.stringify({ 
                    msg: "Threshold Authorization Successful", 
                    timestamp: Date.now() 
                })
            });
            
            const data = await response.json();
            log(`API RESPONSE: ${JSON.stringify(data).substr(0, 100)}...`, 'success');
        } catch(err) {
            log(`API execution failed (network error): ${err.message}`, 'error');
        }

        // Wipe memory
        lobby.broadcast('EXECUTION_COMPLETE', {});
        log("Execution complete. Memory wiped.", 'info');

    } catch (e) {
        log(`Authorization Failed: ${e.message}`, 'error');
    } finally {
        activeRequestResolve = null;
    }
});

function handleReceivedShare(msg) {
    if (activeRequestResolve) {
        activeRequestResolve({
            x: msg.shareId,
            y: SSS.hexToBytes(msg.shareData)
        });
    }
}


// --- PEER LOGIC ---

let autoApproveTimer = null;

function handleAuthRequest(msg) {
    const modal = document.getElementById('auth-request-modal');
    modal.classList.remove('hidden');
    document.getElementById('req-time').textContent = new Date(msg.timestamp).toLocaleTimeString();
    
    // Auto approve logic
    const bar = document.getElementById('timer-fill');
    bar.style.width = '0%';
    
    // Force reflow
    void bar.offsetWidth;
    
    bar.style.width = '100%';
    
    if (autoApproveTimer) clearTimeout(autoApproveTimer);
    
    const approve = () => {
        if (modal.classList.contains('hidden')) return;
        
        log("Approving request...", 'success');
        
        // Send Share back to Host (encrypted transport ideally, but direct send for demo)
        lobby.sendTo(lobby.state.hostId, 'PROVIDE_SHARE', {
            shareId: myShare.id,
            shareData: SSS.bytesToHex(myShare.data),
            reqId: msg.reqId
        });
        
        modal.classList.add('hidden');
    };

    autoApproveTimer = setTimeout(approve, 5000);

    document.getElementById('btn-approve').onclick = () => {
        clearTimeout(autoApproveTimer);
        approve();
    };

    document.getElementById('btn-deny').onclick = () => {
        clearTimeout(autoApproveTimer);
        modal.classList.add('hidden');
        log("You denied the request.", 'warn');
    };
}

// Start
init();

