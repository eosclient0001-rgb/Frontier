/*==========================================================================================================================================
                                                        GENERATEHEIGHTMAPS.MJS
==========================================================================================================================================*/
// 🧩 Render headless heightmap + mask PNGs for the 3 demo terrains from the ported engine.
// Run from the repository root:
//   node Exhibits/TerrainStudio/Code/GenerateHeightmaps.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { WorldMask2D } from '../../../Experimental Remastered/TerrainWorldEditor/Engine/WorldMask2D.js';
import { SeedThreeDemoTerrains, ExtractRegionTriangleMesh } from '../../../Experimental Remastered/TerrainWorldEditor/Engine/TerrainLayerStack.js';

const OutDir = fileURLToPath(new URL('../Images/', import.meta.url));
mkdirSync(OutDir, { recursive: true });

const CRC_TABLE = (() =>
{
    const Table = new Int32Array(256);
    for (let N = 0; N < 256; ++N)
    {
        let C = N;
        for (let K = 0; K < 8; ++K) C = (C & 1) ? (0xedb88320 ^ (C >>> 1)) : (C >>> 1);
        Table[N] = C;
    }
    return Table;
})();

function Crc32(Buffer)
{
    let C = 0xffffffff;
    for (let I = 0; I < Buffer.length; ++I) C = CRC_TABLE[(C ^ Buffer[I]) & 0xff] ^ (C >>> 8);
    return (C ^ 0xffffffff) >>> 0;
}

function PngChunk(Type, Data)
{
    const Len = Buffer.alloc(4);
    Len.writeUInt32BE(Data.length, 0);
    const TypeBuf = Buffer.from(Type, 'ascii');
    const Crc = Buffer.alloc(4);
    Crc.writeUInt32BE(Crc32(Buffer.concat([TypeBuf, Data])), 0);
    return Buffer.concat([Len, TypeBuf, Data, Crc]);
}

function WritePngGray(Path, Width, Height, Gray)
{
    const Signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const Ihdr = Buffer.alloc(13);
    Ihdr.writeUInt32BE(Width, 0);
    Ihdr.writeUInt32BE(Height, 4);
    Ihdr[8] = 8;  // bit depth
    Ihdr[9] = 0;  // grayscale
    Ihdr[10] = 0; Ihdr[11] = 0; Ihdr[12] = 0;
    const Raw = Buffer.alloc(Height * (1 + Width));
    for (let Y = 0; Y < Height; ++Y)
    {
        Raw[Y * (1 + Width)] = 0; // filter: none
        Gray.copy(Raw, Y * (1 + Width) + 1, Y * Width, (Y + 1) * Width);
    }
    const Idat = deflateSync(Raw, { level: 9 });
    writeFileSync(Path, Buffer.concat([Signature, PngChunk('IHDR', Ihdr), PngChunk('IDAT', Idat), PngChunk('IEND', Buffer.alloc(0))]));
}

function WritePngRgb(Path, Width, Height, Rgb)
{
    const Signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const Ihdr = Buffer.alloc(13);
    Ihdr.writeUInt32BE(Width, 0);
    Ihdr.writeUInt32BE(Height, 4);
    Ihdr[8] = 8;
    Ihdr[9] = 2; // truecolor
    Ihdr[10] = 0; Ihdr[11] = 0; Ihdr[12] = 0;
    const Raw = Buffer.alloc(Height * (1 + Width * 3));
    for (let Y = 0; Y < Height; ++Y)
    {
        Raw[Y * (1 + Width * 3)] = 0;
        Rgb.copy(Raw, Y * (1 + Width * 3) + 1, Y * Width * 3, (Y + 1) * Width * 3);
    }
    const Idat = deflateSync(Raw, { level: 9 });
    writeFileSync(Path, Buffer.concat([Signature, PngChunk('IHDR', Ihdr), PngChunk('IDAT', Idat), PngChunk('IEND', Buffer.alloc(0))]));
}

const World = new WorldMask2D();
const { regions } = SeedThreeDemoTerrains(World);

const Summary = [];
for (const Region of regions)
{
    const Rt = Region.runtime;
    const { nx: Nx, nz: Nz, heights: Heights, coverage: Coverage, sdf2D: Sdf2D } = Rt;
    const Mesh = ExtractRegionTriangleMesh(World, Region, { includeUnderside: true });

    // Heightmap: ocean dark blue-black, land shaded by elevation (hypsometric tint in RGB).
    const Rgb = Buffer.alloc(Nx * Nz * 3);
    const Gray = Buffer.alloc(Nx * Nz);
    for (let I = 0; I < Nx * Nz; ++I)
    {
        const H = Heights[I];
        const Cov = Coverage[I];
        const D2 = Sdf2D[I];
        let R, G, B;
        if (D2 > 0)
        {
            // Ocean: depth-darkened blue.
            const Depth = Math.min(1, D2 / 120);
            R = 8 + Math.round(10 * (1 - Depth));
            G = 18 + Math.round(22 * (1 - Depth));
            B = 34 + Math.round(38 * (1 - Depth));
        }
        else
        {
            const T = Math.min(1, Math.max(0, H / Math.max(1, Rt.maxHeight)));
            // Lowland green -> highland brown -> peak white.
            if (T < 0.45)
            {
                const U = T / 0.45;
                R = Math.round(88 + (139 - 88) * U);
                G = Math.round(185 + (125 - 185) * U);
                B = Math.round(130 + (62 - 130) * U);
            }
            else if (T < 0.8)
            {
                const U = (T - 0.45) / 0.35;
                R = Math.round(139 + (160 - 139) * U);
                G = Math.round(125 + (110 - 125) * U);
                B = Math.round(62 + (55 - 62) * U);
            }
            else
            {
                const U = (T - 0.8) / 0.2;
                R = Math.round(160 + (245 - 160) * U);
                G = Math.round(110 + (245 - 110) * U);
                B = Math.round(55 + (240 - 55) * U);
            }
            if (Cov < 0.5)
            {
                R = Math.round(R * 0.4 + 10);
                G = Math.round(G * 0.4 + 14);
                B = Math.round(B * 0.4 + 22);
            }
        }
        Rgb[I * 3] = R; Rgb[I * 3 + 1] = G; Rgb[I * 3 + 2] = B;
        Gray[I] = Math.round(0.299 * R + 0.587 * G + 0.114 * B);
    }

    const Slug = Region.id.replace(/^terrain-/, '');
    WritePngRgb(`${OutDir}/heightmap-${Slug}.png`, Nx, Nz, Rgb);
    WritePngGray(`${OutDir}/height-gray-${Slug}.png`, Nx, Nz, Gray);
    Summary.push(`${Region.name}: ${Nx}x${Nz}, maxHeight=${Rt.maxHeight.toFixed(1)}m, land=${Rt.landAreaKm2.toFixed(2)}km2, tris=${Mesh.triangleCount}`);
}

console.log(Summary.join('\n'));
console.log(`Wrote ${Summary.length * 2} PNGs to ${OutDir}`);
