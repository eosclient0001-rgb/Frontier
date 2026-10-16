// The recovered CPU worker used the same URL but returned pixels instead of draw commands.
// Keep a versioned handshake and validate before accessing description or renderer fields.
export const CommandProtocol = "solidarc-gpu-commands-v1";

export function ValidateCommands(Response)
{
    if (!Response || typeof Response !== "object")
        throw Error("The geometry transport returned no command packet. Reload the GPU preview.");
    const Frame = Response.frame;
    if (!Frame || typeof Frame !== "object")
    {
        const Legacy = "pixels" in Response;
        throw Error(Legacy
            ? "An outdated CPU geometry worker returned pixels instead of GPU draw commands. Reload the GPU preview to load the versioned worker."
            : `The geometry service returned no GPU frame (fields: ${Object.keys(Response).slice(0, 16).join(", ")}). Open the editor preview and reload it; port 8081 is only the geometry service.`);
    }
    if (!Response.description || !Array.isArray(Response.description.figures))
        throw Error("The geometry command packet has no document description. Reload the GPU preview.");
    if (!Number.isInteger(Frame.width) || !Number.isInteger(Frame.height) || Frame.width < 1 || Frame.height < 1 ||
        !Frame.view || !Array.isArray(Frame.draws) || !Array.isArray(Frame.clear) || Frame.clear.length !== 4 ||
        Frame.cpuFragments !== 0 || Frame.rgbaUploads !== 0)
        throw Error("The geometry transport returned an incompatible GPU frame. CPU raster fallback is disabled.");
    return Response;
}
