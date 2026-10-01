export const ENCRYPTION_ENABLED = import.meta.env.VITE_ENABLE_PAYLOAD_ENCRYPTION === 'true';
const ENCRYPTION_KEY_BASE64 = import.meta.env.VITE_ENCRYPTION_KEY || "";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

let importedKey: CryptoKey | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
    if (importedKey) return importedKey;
    if (!ENCRYPTION_KEY_BASE64) {
        throw new Error("VITE_ENCRYPTION_KEY is missing or invalid");
    }
    const keyData = base64ToArrayBuffer(ENCRYPTION_KEY_BASE64);
    importedKey = await window.crypto.subtle.importKey(
        "raw",
        keyData,
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
    );
    return importedKey;
}

export async function encryptPayload(data: any): Promise<any> {
    if (!ENCRYPTION_ENABLED || !data) return data;
    
    try {
        const key = await getEncryptionKey();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encodedData = new TextEncoder().encode(JSON.stringify(data));
        
        const encryptedContent = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            encodedData
        );
        
        return {
            encrypted: true,
            iv: arrayBufferToBase64(iv),
            payload: arrayBufferToBase64(encryptedContent)
        };
    } catch (e) {
        console.error("Payload encryption failed", e);
        throw e;
    }
}

/**
 * Decrypts an encrypted response envelope from the backend.
 * Expects: { encrypted: true, iv: "<base64>", payload: "<base64>" }
 * Returns the original plaintext JS object.
 */
export async function decryptPayload(envelope: any): Promise<any> {
    if (!ENCRYPTION_ENABLED) return envelope;
    if (!envelope || !envelope.encrypted || !envelope.iv || !envelope.payload) {
        return envelope;
    }

    try {
        const key = await getEncryptionKey();
        const iv = base64ToArrayBuffer(envelope.iv);
        const ciphertextWithTag = base64ToArrayBuffer(envelope.payload);

        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            ciphertextWithTag
        );

        const plaintext = new TextDecoder().decode(decryptedBuffer);
        return JSON.parse(plaintext);
    } catch (e) {
        console.error("Response decryption failed", e);
        throw new Error("Failed to decrypt API response. Please refresh and try again.");
    }
}
