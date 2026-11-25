/*====================================================================================================================================
                                                        RASTERARCHIVE.JS
====================================================================================================================================*/
// 🧩 IndexedDB store for Float32 sculpt rasters keyed by "<terrain>:<layer>" (browser-local autosave between sessions)

//------------------------------------------------------------------------------------------------------------------------
//                                                    RASTER ARCHIVE
//------------------------------------------------------------------------------------------------------------------------

export class RasterArchive
{
    constructor()
    {
        this.Opening = new Promise(Resolve =>
        {
            try
            {
                const Request = indexedDB.open("FrontierTerrainAuthoring", 1);
                Request.onupgradeneeded = () => Request.result.createObjectStore("Rasters");
                Request.onsuccess = () => Resolve(Request.result);
                Request.onerror = () => Resolve(null);
            }
            catch { Resolve(null); }
        });
    }

    async Transact(Mode, Action)
    {
        const Database = await this.Opening;
        if (!Database) return null;
        return new Promise(Resolve =>
        {
            const Transaction = Database.transaction("Rasters", Mode);
            const Request = Action(Transaction.objectStore("Rasters"));
            Transaction.oncomplete = () => Resolve(Request ? Request.result : null);
            Transaction.onerror = () => Resolve(null);
        });
    }

    Store(Key, Deltas) { return Deltas ? this.Transact("readwrite", Store => Store.put(Deltas, Key)) : this.Transact("readwrite", Store => Store.delete(Key)); }
    Retrieve(Key) { return this.Transact("readonly", Store => Store.get(Key)); }
    ClearAll() { return this.Transact("readwrite", Store => Store.clear()); }
}
