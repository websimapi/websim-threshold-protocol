// A lightweight byte-wise Shamir Secret Sharing implementation in GF(2^8)
// Based on standard polynomial interpolation.

// GF(256) Logs and Exps (Rijndael finite field)
const LOG = new Uint8Array(256);
const EXP = new Uint8Array(256);

// Precompute tables
(function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 256) x ^= 0x11b; // Irreducible polynomial
    }
    // LOG[0] is undefined, but usually handled by checking for 0
})();

function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    const v = LOG[a] + LOG[b];
    return EXP[v > 254 ? v - 255 : v];
}

function div(a, b) {
    if (b === 0) throw new Error("Division by zero");
    if (a === 0) return 0;
    const v = LOG[a] - LOG[b];
    return EXP[v < 0 ? v + 255 : v];
}

// Generate random bytes
function randomBytes(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return arr;
}

/**
 * Split a secret (Uint8Array) into n shares, with threshold t.
 * Returns an array of objects: { x: number, y: Uint8Array }
 */
export function split(secret, n, t) {
    if (t > n) throw new Error("Threshold cannot be greater than shares");
    if (t < 2) throw new Error("Threshold must be at least 2");

    const len = secret.length;
    const shares = Array.from({ length: n }, (_, i) => ({
        x: i + 1, // Share IDs start at 1
        y: new Uint8Array(len)
    }));

    // For each byte in the secret, create a polynomial f(x) = secret + a1*x + ... + a(t-1)*x^(t-1)
    for (let i = 0; i < len; i++) {
        const coeffs = randomBytes(t - 1); // a1 ... a(t-1)
        const s = secret[i]; // a0

        for (let shareIdx = 0; shareIdx < n; shareIdx++) {
            const x = shares[shareIdx].x;
            let y = s; // f(0)

            // Evaluate polynomial at x using Horner's method or direct sum
            // f(x) = a0 + a1*x + a2*x^2 ...
            let xPow = x;
            for (let c = 0; c < t - 1; c++) {
                y ^= mul(coeffs[c], xPow);
                xPow = mul(xPow, x);
            }
            shares[shareIdx].y[i] = y;
        }
    }

    return shares;
}

/**
 * Combine shares to reconstruct the secret.
 * shares: Array of { x: number, y: Uint8Array }
 */
export function combine(shares) {
    if (shares.length === 0) return new Uint8Array(0);
    const len = shares[0].y.length;
    const secret = new Uint8Array(len);
    
    // We only need the x values and one byte position at a time
    const x = shares.map(s => s.x);
    
    for (let i = 0; i < len; i++) {
        // Collect the y value for this byte position from all shares
        const y = shares.map(s => s.y[i]);
        
        // Lagrange interpolation at x=0
        let result = 0;
        for (let j = 0; j < shares.length; j++) {
            // Compute basis polynomial L_j(0)
            // L_j(0) = product( (0 - x_m) / (x_j - x_m) ) for m != j
            let numerator = 1;
            let denominator = 1;
            
            for (let m = 0; m < shares.length; m++) {
                if (j === m) continue;
                // (0 - x_m) is same as x_m in GF(2^n) because addition is XOR
                numerator = mul(numerator, x[m]);
                denominator = mul(denominator, x[j] ^ x[m]); // Subtraction is XOR
            }
            
            const lagrange = div(numerator, denominator);
            result ^= mul(y[j], lagrange);
        }
        secret[i] = result;
    }
    
    return secret;
}

// Helpers for string conversion
export function strToBytes(str) {
    return new TextEncoder().encode(str);
}

export function bytesToStr(bytes) {
    return new TextDecoder().decode(bytes);
}

export function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

