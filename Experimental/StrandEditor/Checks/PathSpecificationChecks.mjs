//============================================================================================================================================
//                                                        PATHSPECIFICATIONCHECKS.MJS                                                         
//============================================================================================================================================
// 📦 Node checks for the scene paths: closed, scaled to their radius, and evenly spaced by arc length.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PathSampleCount, PathShapeNames, SamplePath } from '../Source/PathSpecification.js';

test('there are five path shapes, matching the choices the inspector offers', () => {
    assert.deepEqual([...PathShapeNames], ['Ring', 'Figure eight', 'Rose', 'Weave', 'Loop']);
});

for (const Shape of PathShapeNames) {
    test('the ' + Shape + ' path is a finite table in the XY plane with one sample per texel', () => {
        const Table = SamplePath(Shape, 5, PathSampleCount);
        assert.equal(Table.Samples.length, PathSampleCount * 4);
        for (let Index = 0; Index < PathSampleCount; Index++) {
            assert.ok(Number.isFinite(Table.Samples[Index * 4]) && Number.isFinite(Table.Samples[Index * 4 + 1]));
            assert.equal(Table.Samples[Index * 4 + 2], 0);
        }
        assert.ok(Table.Length > 0);
    });

    test('the ' + Shape + ' path is closed, so the last sample meets the first and trails cross the seam cleanly', () => {
        const Table = SamplePath(Shape, 5, PathSampleCount);
        const Last = PathSampleCount - 1;
        const Gap = Math.hypot(Table.Samples[Last * 4] - Table.Samples[0], Table.Samples[Last * 4 + 1] - Table.Samples[1]);
        const Spacing = Table.Length / PathSampleCount;
        assert.ok(Gap <= 1.1 * Spacing, 'seam gap ' + Gap.toFixed(4) + ' against spacing ' + Spacing.toFixed(4));
    });

    test('the ' + Shape + ' path reaches exactly its radius, so the size control is honest', () => {
        const Table = SamplePath(Shape, 5, PathSampleCount);
        let Furthest = 0;
        for (let Index = 0; Index < PathSampleCount; Index++) {
            Furthest = Math.max(Furthest, Math.hypot(Table.Samples[Index * 4], Table.Samples[Index * 4 + 1]));
        }
        // 📝 The table is sampled, so its furthest point can sit between two samples; half a percent covers that.
        assert.ok(Math.abs(Furthest - 5) < 0.025, 'furthest ' + Furthest);
    });

    test('the ' + Shape + ' path has even spacing by arc length, so light moves at one speed along it', () => {
        const Table = SamplePath(Shape, 5, PathSampleCount);
        const Spacings = [];
        for (let Index = 0; Index < PathSampleCount; Index++) {
            const Next = (Index + 1) % PathSampleCount;
            Spacings.push(Math.hypot(
                Table.Samples[Next * 4] - Table.Samples[Index * 4],
                Table.Samples[Next * 4 + 1] - Table.Samples[Index * 4 + 1],
            ));
        }
        const Ratio = Math.max(...Spacings) / Math.min(...Spacings);
        // 📝 Chords shorten where a curve turns tighter than the spacing (the rose tips, the weave's near-stop), so this
        // bound is loose. A resampler that spaced samples by parameter would reach about five here on the rose.
        assert.ok(Ratio <= 1.1, 'longest over shortest spacing ' + Ratio.toFixed(4));
    });
}

test('an unknown path shape falls back to the ring rather than reaching the GPU empty', () => {
    const Fallback = SamplePath('Hexagon', 5, 64);
    const Ring = SamplePath('Ring', 5, 64);
    assert.deepEqual(Array.from(Fallback.Samples), Array.from(Ring.Samples));
});
