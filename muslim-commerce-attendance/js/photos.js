/* ==========================================================================
   photos.js — student photographs outside the localStorage register
   --------------------------------------------------------------------------
   A student photograph stored as a base64 data URL inside `mca_students`
   costs roughly 40-80 KB per student. At 2 000 students that is 80-160 MB,
   which no browser will keep in localStorage — the register would fail to
   save and records would be lost.

   Photographs therefore live in IndexedDB (a few hundred MB available),
   keyed by the student record id, and are resized to a small thumbnail in
   the browser before they are stored. The student record only keeps a
   `photoKey` pointer, so the register stays small and fast.

   Thumbnails are loaded lazily and kept in a small in-memory cache, so a
   register with 10 000 photographs never holds 10 000 data URLs in memory
   at once — only the ones currently on screen.

   Falls back to a compressed localStorage map when IndexedDB is not
   available (for example pages opened straight from disk).
   ========================================================================== */

'use strict';

const Photos = (function () {

  const DB_NAME = 'mca-photos';
  const STORE_NAME = 'photos';
  const LS_KEY = 'mca_photos';
  const MAX_EDGE = 320;      /* longest edge of the stored thumbnail */
  const QUALITY = 0.72;      /* JPEG quality */
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_CACHE = 300;     /* thumbnails kept in memory at once */

  /* key -> data URL (most recently used last) */
  const map = new Map();

  let db = null;
  let backend = 'memory';
  let ready = false;

  /* ---------- IndexedDB ---------- */

  function openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      let request;
      try { request = indexedDB.open(DB_NAME, 1); }
      catch (err) { reject(err); return; }

      request.onupgradeneeded = () => {
        const idb = request.result;
        if (!idb.objectStoreNames.contains(STORE_NAME)) {
          idb.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB could not be opened'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
  }

  function idbGet(key) {
    return new Promise((resolve, reject) => {
      if (!db) { resolve(null); return; }
      let request;
      try { request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key); }
      catch (err) { reject(err); return; }
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function idbPut(key, data) {
    return new Promise((resolve, reject) => {
      if (!db) { resolve(false); return; }
      let request;
      try { request = db.transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put({ key: key, data: data, updatedAt: new Date().toISOString() }); }
      catch (err) { reject(err); return; }
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  function idbDelete(key) {
    return new Promise((resolve, reject) => {
      if (!db) { resolve(false); return; }
      let request;
      try { request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key); }
      catch (err) { reject(err); return; }
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  function idbCount() {
    return new Promise((resolve, reject) => {
      if (!db) { resolve(0); return; }
      let request;
      try { request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count(); }
      catch (err) { reject(err); return; }
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  }

  /* ---------- localStorage fallback ---------- */

  function lsRead() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function lsWrite(obj) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------- memory cache ---------- */

  function cacheSet(key, data) {
    if (!key) return;
    if (map.has(key)) map.delete(key);
    map.set(key, data);
    while (map.size > MAX_CACHE) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  /* ---------- Public API ---------- */

  /* Opens the photo store. Safe to call more than once. */
  async function init() {
    if (ready) return backend;
    try {
      db = await openDb();
      backend = 'indexeddb';
    } catch (err) {
      db = null;
      backend = 'localstorage';
    }
    ready = true;
    return backend;
  }

  /* The thumbnail currently held in memory (empty string when it is not). */
  function cached(key) {
    if (!key) return '';
    return map.get(key) || '';
  }

  /* Loads a thumbnail into memory and returns it. */
  async function load(key) {
    if (!key) return '';
    const hit = map.get(key);
    if (hit) {
      /* refresh recency */
      map.delete(key);
      map.set(key, hit);
      return hit;
    }
    if (backend === 'indexeddb') {
      try {
        const row = await idbGet(key);
        if (row && row.data) {
          cacheSet(key, row.data);
          return row.data;
        }
      } catch (err) {
        console.warn('[MCA] photo could not be read from IndexedDB:', err);
      }
      return '';
    }
    const stored = lsRead();
    const data = stored[key] || '';
    if (data) cacheSet(key, data);
    return data;
  }

  /* Loads the thumbnail of a student record (honours the legacy inline photo). */
  async function loadFor(student) {
    if (!student) return '';
    const key = keyFor(student);
    if (key) {
      const data = await load(key);
      if (data) return data;
    }
    return student.photo || '';
  }

  function get(key) {
    return cached(key);
  }

  async function set(key, data) {
    if (!key) return false;
    cacheSet(key, data || '');
    if (backend === 'indexeddb') {
      try { await idbPut(key, data); return true; }
      catch (err) { console.warn('[MCA] photo could not be written to IndexedDB:', err); return false; }
    }
    const all = lsRead();
    all[key] = data;
    return lsWrite(all);
  }

  async function remove(key) {
    if (!key) return false;
    map.delete(key);
    if (backend === 'indexeddb') {
      try { await idbDelete(key); } catch (err) { /* ignore */ }
      return true;
    }
    const all = lsRead();
    delete all[key];
    return lsWrite(all);
  }

  /* The photo key a student record points at. */
  function keyFor(student) {
    if (!student) return '';
    if (student.photoKey) return student.photoKey;
    if (student.id) return 'ph_' + student.id;
    return '';
  }

  /* The image source for a student record, whichever store holds it.
     Only photographs already in memory are returned synchronously — use
     loadFor() when the photograph is still on disk. */
  function src(student) {
    if (!student) return '';
    if (student.photoKey) {
      const stored = cached(student.photoKey);
      if (stored) return stored;
    }
    return student.photo || '';
  }

  function has(student) {
    if (!student) return false;
    if (student.photoKey) return !!cached(student.photoKey);
    return !!student.photo;
  }

  /* Resizes an image file to a small JPEG thumbnail. Returns a data URL. */
  function compress(file, maxEdge, quality) {
    const edge = maxEdge || MAX_EDGE;
    const q = quality || QUALITY;
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('No file supplied')); return; }
      if (file.size > MAX_FILE_BYTES) {
        reject(new Error('That image is larger than 8 MB.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The image file could not be read.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not a readable image.'));
        img.onload = () => {
          try {
            const scale = Math.min(1, edge / Math.max(img.width || 1, img.height || 1));
            const w = Math.max(1, Math.round((img.width || 1) * scale));
            const h = Math.max(1, Math.round((img.height || 1) * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('This browser cannot process images.')); return; }
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', q));
          } catch (err) {
            reject(err);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* Approximate bytes used by the photographs currently in memory. */
  function usage() {
    let bytes = 0;
    map.forEach(data => { bytes += (data || '').length * 2; });
    return { count: map.size, bytes: bytes };
  }

  /* How many photographs are stored on disk. */
  async function count() {
    if (backend === 'indexeddb') {
      try { return await idbCount(); }
      catch (err) { return 0; }
    }
    return Object.keys(lsRead()).length;
  }

  return {
    init: init,
    get: get,
    cached: cached,
    load: load,
    loadFor: loadFor,
    set: set,
    remove: remove,
    keyFor: keyFor,
    src: src,
    has: has,
    compress: compress,
    usage: usage,
    count: count,
    map: map,
    get backend() { return backend; },
    get ready() { return ready; }
  };
})();

window.Photos = Photos;
