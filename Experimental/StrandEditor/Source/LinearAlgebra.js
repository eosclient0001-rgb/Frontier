//============================================================================================================================================
//                                                              LINEARALGEBRA.JS
//============================================================================================================================================
// 📦 Column-major matrices, vector helpers and sRGB conversion shared by the editor, renderer and tests.

// 📝 Matrices are column-major Float32Arrays, the layout WebGL uniforms expect: element [Column * 4 + Row].

export function Add(A, B) {
    return [A[0] + B[0], A[1] + B[1], A[2] + B[2]];
}

export function Subtract(A, B) {
    return [A[0] - B[0], A[1] - B[1], A[2] - B[2]];
}

export function Scale(A, Factor) {
    return [A[0] * Factor, A[1] * Factor, A[2] * Factor];
}

export function Dot(A, B) {
    return A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
}

export function Cross(A, B) {
    return [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
}

export function Length(A) {
    return Math.sqrt(Dot(A, A));
}

export function Normalize(A, Fallback = [0, 1, 0]) {
    const Size = Length(A);
    return Size > 1e-12 ? Scale(A, 1 / Size) : Fallback.slice();
}

export function Mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function Mat4Multiply(A, B) {
    const Out = new Float32Array(16);
    for (let Column = 0; Column < 4; Column++) {
        for (let Row = 0; Row < 4; Row++) {
            let Sum = 0;
            for (let K = 0; K < 4; K++) {
                Sum += A[K * 4 + Row] * B[Column * 4 + K];
            }
            Out[Column * 4 + Row] = Sum;
        }
    }
    return Out;
}

// 📐 OpenGL clip convention: depth in [-1, 1], camera looks down -Z in view space.
export function Mat4Perspective(FovYRadians, Aspect, Near, Far) {
    const Focal = 1 / Math.tan(FovYRadians / 2);
    const Out = new Float32Array(16);
    Out[0] = Focal / Aspect;
    Out[5] = Focal;
    Out[10] = (Far + Near) / (Near - Far);
    Out[11] = -1;
    Out[14] = (2 * Far * Near) / (Near - Far);
    return Out;
}

export function Mat4LookAt(Eye, Target, Up) {
    const Forward = Normalize(Subtract(Target, Eye), [0, 0, -1]);
    const Side = Normalize(Cross(Forward, Up), [1, 0, 0]);
    const Upward = Cross(Side, Forward);
    return new Float32Array([
        Side[0], Upward[0], -Forward[0], 0,
        Side[1], Upward[1], -Forward[1], 0,
        Side[2], Upward[2], -Forward[2], 0,
        -Dot(Side, Eye), -Dot(Upward, Eye), Dot(Forward, Eye), 1,
    ]);
}

// 📝 Row-major 3x3 helpers. Mat3FromEulerDegrees converts once to column-major for the shader.
function RotationX(Angle) {
    const C = Math.cos(Angle), S = Math.sin(Angle);
    return [1, 0, 0, 0, C, -S, 0, S, C];
}

function RotationY(Angle) {
    const C = Math.cos(Angle), S = Math.sin(Angle);
    return [C, 0, S, 0, 1, 0, -S, 0, C];
}

function RotationZ(Angle) {
    const C = Math.cos(Angle), S = Math.sin(Angle);
    return [C, -S, 0, S, C, 0, 0, 0, 1];
}

function Multiply3(A, B) {
    const Out = new Array(9).fill(0);
    for (let Row = 0; Row < 3; Row++) {
        for (let Column = 0; Column < 3; Column++) {
            for (let K = 0; K < 3; K++) {
                Out[Row * 3 + Column] += A[Row * 3 + K] * B[K * 3 + Column];
            }
        }
    }
    return Out;
}

// 📝 Yaw about Y, then pitch about X, then roll about Z: R = Ry * Rx * Rz, in degrees.
export function Mat3FromEulerDegrees(Yaw, Pitch, Roll) {
    const Degrees = Math.PI / 180;
    const Rotation = Multiply3(Multiply3(RotationY(Yaw * Degrees), RotationX(Pitch * Degrees)), RotationZ(Roll * Degrees));
    const Out = new Float32Array(9);
    for (let Row = 0; Row < 3; Row++) {
        for (let Column = 0; Column < 3; Column++) {
            Out[Column * 3 + Row] = Rotation[Row * 3 + Column];
        }
    }
    return Out;
}

export function TransformPoint(Matrix, Point) {
    const X = Point[0], Y = Point[1], Z = Point[2];
    return [
        Matrix[0] * X + Matrix[4] * Y + Matrix[8] * Z + Matrix[12],
        Matrix[1] * X + Matrix[5] * Y + Matrix[9] * Z + Matrix[13],
        Matrix[2] * X + Matrix[6] * Y + Matrix[10] * Z + Matrix[14],
        Matrix[3] * X + Matrix[7] * Y + Matrix[11] * Z + Matrix[15],
    ];
}

// 🔢 IEC 61966-2-1 transfer function, encoded channel in [0, 1] to linear light.
export function SrgbChannelToLinear(Encoded) {
    return Encoded <= 0.04045 ? Encoded / 12.92 : Math.pow((Encoded + 0.055) / 1.055, 2.4);
}

export function HexToLinear(Hex) {
    const Digits = Hex.replace('#', '');
    return [0, 1, 2].map((Index) => SrgbChannelToLinear(parseInt(Digits.slice(Index * 2, Index * 2 + 2), 16) / 255));
}
