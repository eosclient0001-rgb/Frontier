//============================================================================================================================================
//                                                               ORBITCAMERA.JS
//============================================================================================================================================
// 📦 Orbit camera maths from scene settings, plus the drag and wheel edits that write back to the scene.

import { Mat4LookAt, Mat4Multiply, Mat4Perspective } from './LinearAlgebra.js';

const Degrees = Math.PI / 180;

// 📝 Yaw 0 and pitch 0 look straight down -Z from +Z, so the fibre plane faces the viewer by default.
export function CameraMatrices(Camera, Aspect) {
    const Yaw = Camera.Yaw * Degrees;
    const Pitch = Camera.Pitch * Degrees;
    const Eye = [
        Camera.Distance * Math.cos(Pitch) * Math.sin(Yaw),
        Camera.Distance * Math.sin(Pitch),
        Camera.Distance * Math.cos(Pitch) * Math.cos(Yaw),
    ];
    const View = Mat4LookAt(Eye, [0, 0, 0], [0, 1, 0]);
    const Projection = Mat4Perspective(Camera.Fov * Degrees, Aspect, 0.05, 200);
    return { ViewProjection: Mat4Multiply(Projection, View), Position: Eye };
}

function WrapDegrees(Setting) {
    return ((Setting + 540) % 360) - 180;
}

export function ApplyDrag(Camera, DeltaX, DeltaY) {
    Camera.Yaw = WrapDegrees(Camera.Yaw + DeltaX * 0.3);
    Camera.Pitch = Math.min(80, Math.max(-80, Camera.Pitch + DeltaY * 0.3));
}

export function ApplyZoom(Camera, DeltaY) {
    Camera.Distance = Math.min(40, Math.max(2, Camera.Distance * Math.exp(DeltaY * 0.001)));
}

export function ResetView(Camera) {
    Camera.Yaw = 0;
    Camera.Pitch = 0;
    Camera.Distance = 9;
}
