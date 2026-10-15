// WHERE THE PHONE KEEPS ITS KEY FOR THE RELAY: the browser's own database for
// this site, which the page and its service worker can both read. A page added
// to the home screen gets a database of its own, so it is filled from the
// address the icon opens (#k=…) the first time that icon is used.
const DB = 'agentbox-relay';
const STORE = 'keys';

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readKey() {
  const d = await db();
  return new Promise((resolve) => {
    const req = d.transaction(STORE).objectStore(STORE).get('key');
    req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
    req.onerror = () => resolve(null);
  });
}

export async function writeKey(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(key, 'key');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** The key in an address the Mac's code made: …/#k=<key>. */
export function keyFromHash(hash) {
  const m = /(?:^#|&)k=([A-Za-z0-9_-]{24,})/.exec(String(hash ?? ''));
  return m ? m[1] : null;
}
