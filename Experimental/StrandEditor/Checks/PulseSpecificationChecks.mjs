//============================================================================================================================================
//                                                        PULSESPECIFICATIONCHECKS.MJS                                                        
//============================================================================================================================================
// 📦 Node checks for the pulse curves: range, periodicity across the loop seam, and the beat count of the heartbeat.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PulseLevelAt, PulseShapeNames } from '../Source/PulseSpecification.js';

test('there are three pulse shapes: Breathe, Heartbeat and Ripple', () => {
    assert.deepEqual([...PulseShapeNames], ['Breathe', 'Heartbeat', 'Ripple']);
});

for (const Shape of PulseShapeNames) {
    test(Shape + ' stays inside [0, 1] and repeats exactly every cycle', () => {
        for (let Step = 0; Step < 400; Step++) {
            const Cycle = Step / 400;
            const Level = PulseLevelAt(Cycle, Shape);
            assert.ok(Level >= 0 && Level <= 1, Shape + ' at ' + Cycle + ' is ' + Level);
            assert.ok(Math.abs(Level - PulseLevelAt(Cycle + 2, Shape)) < 1e-9);
        }
    });
}

test('Breathe rests at the start of the cycle and crests in the middle, like an inhale and exhale', () => {
    assert.ok(PulseLevelAt(0, 'Breathe') < 1e-9);
    assert.ok(Math.abs(PulseLevelAt(0.5, 'Breathe') - 1) < 1e-9);
});

test('Heartbeat has two beats per cycle and rests between them', () => {
    const Samples = [];
    for (let Step = 0; Step < 1000; Step++) Samples.push(PulseLevelAt(Step / 1000, 'Heartbeat'));
    let Peaks = 0;
    for (let Index = 1; Index < Samples.length - 1; Index++) {
        if (Samples[Index] > 0.2 && Samples[Index] >= Samples[Index - 1] && Samples[Index] > Samples[Index + 1]) Peaks += 1;
    }
    assert.equal(Peaks, 2, 'beats per cycle');
    assert.ok(PulseLevelAt(0.6, 'Heartbeat') < 0.01, 'rest between beats');
    assert.ok(Math.abs(PulseLevelAt(0.1, 'Heartbeat') - 1) < 1e-6, 'first beat reaches full level');
});
