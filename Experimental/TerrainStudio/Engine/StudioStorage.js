/*====================================================================================================================================
                                                        STUDIOSTORAGE.JS
====================================================================================================================================*/
// 🧩 Project persistence: IndexedDB (document + Float32 sculpt textures) and portable JSON export/import

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const DatabaseName = "FrontierTerrainStudio";
const StoreName = "Projects";
const ProjectKey = "Current";
export const DocumentStorageKey = "Frontier.TerrainStudio.Document";

//------------------------------------------------------------------------------------------------------------------------
//                                                  INDEXEDDB STORE
//------------------------------------------------------------------------------------------------------------------------

function OpenDatabase()
{
    return new Promise((Resolve, Reject) =>
    {
        if (typeof indexedDB === "undefined") { Reject(new Error("IndexedDB unavailable")); return; }
        const Request = indexedDB.open(DatabaseName, 1);
        Request.onupgradeneeded = () => Request.result.createObjectStore(StoreName);
        Request.onsuccess = () => Resolve(Request.result);
        Request.onerror = () => Reject(Request.error);
    });
}

export async function StoreProject(Project)
{
    const Database = await OpenDatabase();
    await new Promise((Resolve, Reject) =>
    {
        const Transaction = Database.transaction(StoreName, "readwrite");
        Transaction.objectStore(StoreName).put(Project, ProjectKey);
        Transaction.oncomplete = Resolve;
        Transaction.onerror = () => Reject(Transaction.error);
    });
    Database.close();
}

export async function RetrieveProject()
{
    const Database = await OpenDatabase();
    const Project = await new Promise((Resolve, Reject) =>
    {
        const Request = Database.transaction(StoreName, "readonly").objectStore(StoreName).get(ProjectKey);
        Request.onsuccess = () => Resolve(Request.result ?? null);
        Request.onerror = () => Reject(Request.error);
    });
    Database.close();
    return Project;
}

//------------------------------------------------------------------------------------------------------------------------
//                                               PORTABLE JSON ARCHIVE
//------------------------------------------------------------------------------------------------------------------------

function EncodeFloats(Values)
{
    const Bytes = new Uint8Array(Values.buffer, Values.byteOffset, Values.byteLength);
    let Binary = "";
    for (let Offset = 0; Offset < Bytes.length; Offset += 0x8000) Binary += String.fromCharCode.apply(null, Bytes.subarray(Offset, Offset + 0x8000));
    return btoa(Binary);
}

function DecodeFloats(Text)
{
    const Binary = atob(Text);
    const Bytes = new Uint8Array(Binary.length);
    for (let Index = 0; Index < Binary.length; Index++) Bytes[Index] = Binary.charCodeAt(Index);
    return new Float32Array(Bytes.buffer);
}

export function EncodeProjectArchive(Document, SculptArchive)
{
    return JSON.stringify({
        Format: "FrontierTerrainStudio",
        Document,
        Sculpt: SculptArchive.map((Entry) => ({ ...Entry, Values: EncodeFloats(Entry.Values) })),
    });
}

export function DecodeProjectArchive(Text)
{
    const Parsed = JSON.parse(Text);
    if (Parsed.Format !== "FrontierTerrainStudio") throw new Error("Not a Terrain Studio archive.");
    return { Document: Parsed.Document, Sculpt: (Parsed.Sculpt ?? []).map((Entry) => ({ ...Entry, Values: DecodeFloats(Entry.Values) })) };
}
