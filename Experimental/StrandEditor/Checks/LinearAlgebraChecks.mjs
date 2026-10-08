//============================================================================================================================================
//                                                          LINEARALGEBRACHECKS.MJS                                                           
//============================================================================================================================================
// 📦 Node checks for the matrix conventions the camera and shaders rely on: look-at, projection, Euler rotations and sRGB.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    HexToLinear, Mat3FromEulerDegrees, Mat4LookAt, Mat4Multiply, Mat4Perspective, TransformPoint,
} from '../Source/LinearAlgebra.js';

function Near(Actual, Expected, Tolerance = 1e-5) {
    assert.ok(Math.abs(Actual - Expected) <= Tolerance, `expected ${Actual} to be within ${Tolerance} of ${Expected}`);
}

test('look-at maps the target onto the negative Z axis at the eye distance', () => {
    const View = Mat4LookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
    const Transformed = TransformPoint(View, [0, 0, 0]);
    Near(Transformed[0], 0);
    Near(Transformed[1], 0);
    Near(Transformed[2], -5);
});

test('perspective projection puts the view centre at NDC zero and keeps w equal to depth', () => {
    const Projection = Mat4Perspective(Math.PI / 3, 16 / 9, 0.1, 100);
    const Clip = TransformPoint(Projection, [0, 0, -4]);
    Near(Clip[0], 0);
    Near(Clip[1], 0);
    Near(Clip[3], 4);
    // OpenGL depth: z_ndc = (A * z + B) / -z with A = (Far + Near) / (Near - Far) and B = 2 * Far * Near / (Near - Far).
    const A = (100 + 0.1) / (0.1 - 100);
    const B = (2 * 100 * 0.1) / (0.1 - 100);
    Near(Clip[2] / Clip[3], (A * -4 + B) / 4, 1e-5);
});

test('view-projection composition keeps the scene target at the screen centre', () => {
    const View = Mat4LookAt([3, 2, 8], [0, 0, 0], [0, 1, 0]);
    const Projection = Mat4Perspective(0.6, 1.5, 0.05, 200);
    const Combined = Mat4Multiply(Projection, View);
    const Clip = TransformPoint(Combined, [0, 0, 0]);
    Near(Clip[0] / Clip[3], 0, 1e-5);
    Near(Clip[1] / Clip[3], 0, 1e-5);
});

test('Euler rotation matrices are orthonormal with determinant one', () => {
    const Rotation = Mat3FromEulerDegrees(23, -41, 117);
    const Column = (Index) => [Rotation[Index * 3], Rotation[Index * 3 + 1], Rotation[Index * 3 + 2]];
    for (let A = 0; A < 3; A++) {
        for (let B = 0; B < 3; B++) {
            const Dot = Column(A).reduce((Sum, Setting, Index) => Sum + Setting * Column(B)[Index], 0);
            Near(Dot, A === B ? 1 : 0, 1e-5);
        }
    }
    const [A, B, C] = [Column(0), Column(1), Column(2)];
    const Determinant = A[0] * (B[1] * C[2] - B[2] * C[1]) - B[0] * (A[1] * C[2] - A[2] * C[1]) + C[0] * (A[1] * B[2] - A[2] * B[1]);
    Near(Determinant, 1, 1e-5);
});

test('yaw of ninety degrees turns +X into -Z in the engine convention', () => {
    const Rotation = Mat3FromEulerDegrees(90, 0, 0);
    const Transformed = [
        Rotation[0] * 1 + Rotation[3] * 0 + Rotation[6] * 0,
        Rotation[1] * 1 + Rotation[4] * 0 + Rotation[7] * 0,
        Rotation[2] * 1 + Rotation[5] * 0 + Rotation[8] * 0,
    ];
    Near(Transformed[0], 0, 1e-6);
    Near(Transformed[2], -1, 1e-6);
});

test('sRGB hex conversion matches the transfer function at the ends and at mid grey', () => {
    assert.deepEqual(HexToLinear('#000000').map((Setting) => Math.round(Setting * 1e6)), [0, 0, 0]);
    assert.deepEqual(HexToLinear('#ffffff').map((Setting) => Math.round(Setting * 1e6)), [1e6, 1e6, 1e6]);
    Near(HexToLinear('#808080')[0], 0.2158605, 1e-6);
    const Albedo = HexToLinear('#c06bbf');
    Near(Albedo[0], 0.527115, 1e-5);
    Near(Albedo[1], 0.147027, 1e-5);
    Near(Albedo[2], 0.520996, 1e-5);
});
