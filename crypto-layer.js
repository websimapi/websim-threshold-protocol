// Wrappers for WebCrypto API

export async function generateKey() {
    return window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

export async function exportKey(key) {
    const exported = await window.crypto.subtle.exportKey("raw", key);
    return new Uint8Array(exported);
}

export async function importKey(rawBytes) {
    return window.crypto.subtle.importKey(
        "raw",
        rawBytes,
        "AES-GCM",
        true,
        ["encrypt", "decrypt"]
    );
}

export async function encryptData(key, plaintext) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encoded
    );

    return {
        iv: iv,
        data: new Uint8Array(ciphertext)
    };
}

export async function decryptData(key, encryptedObj) {
    const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: encryptedObj.iv },
        key,
        encryptedObj.data
    );

    return new TextDecoder().decode(decrypted);
}

// Convert buffers to/from base64 for transport
export function bufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export function base64ToBuffer(b64) {
    const binary_string = window.atob(b64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes;
}

