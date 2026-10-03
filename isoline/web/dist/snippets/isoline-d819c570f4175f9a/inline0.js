
export function isoline_download(name, mime, bytes) {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
}
function isoline_db() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('isoline', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('blobs'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
export async function isoline_store_put(key, bytes) {
    const db = await isoline_db();
    const copy = new Uint8Array(bytes);
    await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put(copy, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}
export async function isoline_store_get(key) {
    const db = await isoline_db();
    const value = await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readonly');
        const req = tx.objectStore('blobs').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    db.close();
    return value === undefined ? null : value;
}
export async function isoline_store_delete(key) {
    const db = await isoline_db();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}
