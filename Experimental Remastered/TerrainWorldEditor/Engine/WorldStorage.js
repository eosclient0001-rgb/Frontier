/*==========================================================================================================================================
                                                          WORLDSTORAGE.JS
==========================================================================================================================================*/
// IndexedDB World Document Persistence for Frontier Terrain Studio (adapted from c7egoist/Frontier world-storage.js).
// Stores sparse 2D world mask tiles, independent Terrain Bounds layers, and non-destructive procedural layer stacks
// asynchronously in IndexedDB without localStorage size limits, and degrades cleanly in headless Node environments.

const DB_NAME = 'frontier-terrain-studio-v1';
const DB_VERSION = 1;
const STORE_NAME = 'worlds';
const CURRENT_KEY = 'current';

function OpenDatabase()
{
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((Resolve, Reject) =>
    {
        const Req = indexedDB.open(DB_NAME, DB_VERSION);
        Req.onupgradeneeded = () =>
        {
            const Db = Req.result;
            if (!Db.objectStoreNames.contains(STORE_NAME))
            {
                Db.createObjectStore(STORE_NAME);
            }
        };
        Req.onsuccess = () => Resolve(Req.result);
        Req.onerror = () => Reject(Req.error);
    });
}

export async function LoadWorldFromStorage()
{
    const Db = await OpenDatabase();
    if (!Db) return null;
    try
    {
        return await new Promise((Resolve, Reject) =>
        {
            const Req = Db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(CURRENT_KEY);
            Req.onsuccess = () => Resolve(Req.result || null);
            Req.onerror = () => Reject(Req.error);
        });
    }
    finally
    {
        Db.close();
    }
}

export async function SaveWorldToStorage(WorldJson)
{
    const Db = await OpenDatabase();
    if (!Db) return false;
    try
    {
        await new Promise((Resolve, Reject) =>
        {
            const Tx = Db.transaction(STORE_NAME, 'readwrite');
            Tx.objectStore(STORE_NAME).put(WorldJson, CURRENT_KEY);
            Tx.oncomplete = () => Resolve(true);
            Tx.onerror = () => Reject(Tx.error);
            Tx.onabort = () => Reject(Tx.error || new Error('Terrain Studio IndexedDB save aborted'));
        });
        return true;
    }
    finally
    {
        Db.close();
    }
}

export async function ClearWorldStorage()
{
    const Db = await OpenDatabase();
    if (!Db) return false;
    try
    {
        await new Promise((Resolve, Reject) =>
        {
            const Tx = Db.transaction(STORE_NAME, 'readwrite');
            Tx.objectStore(STORE_NAME).delete(CURRENT_KEY);
            Tx.oncomplete = () => Resolve(true);
            Tx.onerror = () => Reject(Tx.error);
        });
        return true;
    }
    finally
    {
        Db.close();
    }
}
