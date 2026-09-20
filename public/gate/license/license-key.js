// Local key lifecycle. This module makes no network requests.
const encoder = new TextEncoder();
const databaseName = "mfenx-license-device-v1";
const iterations = 600000;
const algorithm = { name: "ECDSA", namedCurve: "P-256" };

export function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export function base64ToBytes(value, maximum = 8192) {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Unsupported encoded key data.");
  const bytes = Uint8Array.from(atob(value), (character) =>
    character.charCodeAt(0),
  );
  if (bytesToBase64(bytes) !== value)
    throw new Error("Non-canonical encoded key data.");
  return bytes;
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...expected].sort().join(",")
  );
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("identity");
    request.onblocked = () =>
      reject(new Error("Close other license tabs, then try again."));
    request.onerror = () =>
      reject(
        new Error("This browser could not open private local key storage."),
      );
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function readRecord() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("identity", "readonly");
      const request = transaction.objectStore("identity").get("current");
      transaction.oncomplete = () => resolve(request.result || null);
      transaction.onabort = transaction.onerror = () =>
        reject(new Error("The browser key could not be read."));
    });
  } finally {
    database.close();
  }
}

async function insertRecord(record) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("identity", "readwrite");
      transaction.objectStore("identity").add(record, "current");
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () =>
        reject(
          new Error(
            "A browser key already exists or storage failed. Reload before continuing; no existing key was replaced.",
          ),
        );
    });
  } finally {
    database.close();
  }
  return loadIdentity();
}

export async function updateIdentity(keyId, changes) {
  const allowed = new Set([
    "backup_saved",
    "license_id",
    "transaction_id",
    "request_id",
    "plan",
    "license",
  ]);
  if (Object.keys(changes).some((key) => !allowed.has(key)))
    throw new Error("Unsupported local key update.");
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("identity", "readwrite");
      const store = transaction.objectStore("identity");
      const request = store.get("current");
      request.onsuccess = () => {
        if (request.result?.key_id !== keyId) {
          transaction.abort();
          return;
        }
        store.put({ ...request.result, ...changes }, "current");
      };
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () =>
        reject(
          new Error(
            "The browser key changed or storage failed. Reload before continuing.",
          ),
        );
    });
  } finally {
    database.close();
  }
  return readRecord();
}

async function validatePair(privateKey, spki, expectedId) {
  if (
    !(privateKey instanceof CryptoKey) ||
    privateKey.type !== "private" ||
    privateKey.extractable ||
    privateKey.algorithm.name !== "ECDSA" ||
    privateKey.algorithm.namedCurve !== "P-256" ||
    privateKey.usages.length !== 1 ||
    privateKey.usages[0] !== "sign"
  )
    throw new Error(
      "The saved browser key is not a non-exportable P-256 signing key.",
    );
  const publicBytes = base64ToBytes(spki, 256);
  if (
    publicBytes.length !== 91 ||
    "sha256:" + (await sha256(publicBytes)) !== expectedId
  )
    throw new Error("The saved key identifier does not match its public key.");
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicBytes,
    algorithm,
    false,
    ["verify"],
  );
  const sample = encoder.encode(
    "mfenx:local-key-check:v1:" +
      bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    sample,
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      sample,
    ))
  )
    throw new Error("The saved public and private keys do not match.");
}

export async function loadIdentity() {
  const record = await readRecord();
  if (!record) return null;
  if (record.version !== 1) throw new Error("Unsupported browser key version.");
  await validatePair(
    record.private_key,
    record.public_key_spki_base64,
    record.key_id,
  );
  return record;
}

function validateBackup(backup) {
  if (
    !exactKeys(backup, [
      "format",
      "version",
      "key_id",
      "public_key_spki_base64",
      "encryption",
    ]) ||
    backup.format !== "mfenx-license-key-backup" ||
    backup.version !== 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(backup.key_id) ||
    !exactKeys(backup.encryption, [
      "kdf",
      "iterations",
      "salt_base64",
      "cipher",
      "iv_base64",
      "ciphertext_base64",
    ]) ||
    backup.encryption.kdf !== "PBKDF2-SHA256" ||
    backup.encryption.iterations !== iterations ||
    backup.encryption.cipher !== "AES-256-GCM"
  )
    throw new Error("Unsupported encrypted recovery-file format.");
  if (
    base64ToBytes(backup.public_key_spki_base64, 256).length !== 91 ||
    base64ToBytes(backup.encryption.salt_base64, 32).length !== 16 ||
    base64ToBytes(backup.encryption.iv_base64, 24).length !== 12 ||
    base64ToBytes(backup.encryption.ciphertext_base64, 2048).length < 32
  )
    throw new Error("Invalid encrypted recovery-file parameters.");
}

function backupBinding(backup) {
  return encoder.encode(
    `mfenx:license-key-backup:v1\n${backup.key_id}\n${backup.public_key_spki_base64}\n${iterations}`,
  );
}

async function encryptionKey(password, salt) {
  const bytes = encoder.encode(password);
  if ([...password].length < 12 || bytes.length > 1024) {
    bytes.fill(0);
    throw new Error(
      "Use a recovery passphrase of at least 12 characters and at most 1,024 UTF-8 bytes.",
    );
  }
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      bytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    bytes.fill(0);
  }
}

function newRecord(privateKey, backup) {
  return {
    version: 1,
    private_key: privateKey,
    public_key_spki_base64: backup.public_key_spki_base64,
    key_id: backup.key_id,
    backup,
    backup_saved: false,
    license_id: null,
    transaction_id: null,
    request_id: null,
    plan: null,
    license: null,
  };
}

export async function createIdentity(password) {
  // Exportability exists only while producing the user-encrypted backup.
  // The key stored in IndexedDB is a separately imported nonextractable key.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await encryptionKey(password, salt);
  const pair = await crypto.subtle.generateKey(algorithm, true, [
    "sign",
    "verify",
  ]);
  const publicBytes = await crypto.subtle.exportKey("spki", pair.publicKey);
  const backup = {
    format: "mfenx-license-key-backup",
    version: 1,
    key_id: "sha256:" + (await sha256(publicBytes)),
    public_key_spki_base64: bytesToBase64(publicBytes),
    encryption: {
      kdf: "PBKDF2-SHA256",
      iterations,
      salt_base64: bytesToBase64(salt),
      cipher: "AES-256-GCM",
      iv_base64: bytesToBase64(iv),
      ciphertext_base64: "",
    },
  };
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  try {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: backupBinding(backup),
        tagLength: 128,
      },
      wrappingKey,
      pkcs8,
    );
    backup.encryption.ciphertext_base64 = bytesToBase64(ciphertext);
    const localKey = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      algorithm,
      false,
      ["sign"],
    );
    return await insertRecord(newRecord(localKey, backup));
  } finally {
    pkcs8.fill(0);
  }
}

export async function restoreIdentity(source, password) {
  if (typeof source !== "string" || encoder.encode(source).length > 16384)
    throw new Error("The recovery file exceeds the supported size.");
  let backup;
  try {
    backup = JSON.parse(source);
  } catch {
    throw new Error("The recovery file is not valid JSON.");
  }
  validateBackup(backup);
  const wrappingKey = await encryptionKey(
    password,
    base64ToBytes(backup.encryption.salt_base64),
  );
  let pkcs8;
  try {
    pkcs8 = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(backup.encryption.iv_base64),
          additionalData: backupBinding(backup),
          tagLength: 128,
        },
        wrappingKey,
        base64ToBytes(backup.encryption.ciphertext_base64),
      ),
    );
  } catch {
    throw new Error(
      "The passphrase is incorrect or the recovery file has been modified.",
    );
  }
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      algorithm,
      false,
      ["sign"],
    );
    await validatePair(
      privateKey,
      backup.public_key_spki_base64,
      backup.key_id,
    );
    return await insertRecord(newRecord(privateKey, backup));
  } finally {
    pkcs8.fill(0);
  }
}

export async function signMessage(identity, message) {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    identity.private_key,
    encoder.encode(message),
  );
  if (signature.byteLength !== 64)
    throw new Error("Unsupported browser signature encoding.");
  return bytesToBase64(signature);
}
