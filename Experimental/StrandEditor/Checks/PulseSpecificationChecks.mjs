//============================================================================================================================================
//                                                        PULSESPECIFICATIONCHECKS.MJS                                                        
//============================================================================================================================================
// 📦 Node checks for the pulse curves: range, periodicity across the loop seam, and the beat count of the heartbeat.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PulseLevelAt, PulseShapeNames, SweepLevelAt } from '../Source/PulseSpecification.js';

test('there are four pulse shapes: Breathe, Heartbeat, Ripple and Sweep', () => {
    assert.deepEqual([...PulseShapeNames], ['Breathe', 'Heartbeat', 'Ripple', 'Sweep']);
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

test('Sweep stays inside [0, 1] at every arc position and every cycle', () => {
    for (let Step = 0; Step <= 200; Step++) {
        for (let Cut = 0; Cut < 100; Cut++) {
            const Level = SweepLevelAt(Step / 200, Cut / 100);
            assert.ok(Level >= 0 && Level <= 1, 'sweep at ' + Step / 200 + ', ' + Cut / 100 + ' is ' + Level);
        }
    }
});

test('Sweep repeats exactly every cycle, and PulseLevelAt routes the Sweep shape to it', () => {
    for (let Step = 0; Step < 100; Step++) {
        const Cycle = Step / 100;
        assert.ok(Math.abs(SweepLevelAt(0.37, Cycle) - SweepLevelAt(0.37, Cycle + 3)) < 1e-9, 'period at cycle ' + Cycle);
        assert.equal(PulseLevelAt(Cycle, 'Sweep', 0.37), SweepLevelAt(0.37, Cycle));
    }
});

test('Sweep is dark at the start of the cycle and again by 99 %, so the loop restarts from black', () => {
    for (let Step = 0; Step <= 100; Step++) {
        const Position = Step / 100;
        assert.equal(SweepLevelAt(Position, 0), 0, 'dark at the cycle start, position ' + Position);
        assert.ok(SweepLevelAt(Position, 0.99) < 0.01, 'dark by 99 %, position ' + Position);
    }
});

test('the front runs from the start of the fibre to its end by 45 % of the cycle, and the lit share never falls on the rise', () => {
    const LitShare = (Cycle) => {
        let Count = 0;
        for (let Step = 0; Step <= 200; Step++) if (SweepLevelAt(Step / 200, Cycle) > 0.3) Count += 1;
        return Count / 201;
    };
    let Previous = -1;
    for (let Step = 0; Step <= 45; Step++) {
        const Share = LitShare(Step / 100);
        assert.ok(Share >= Previous - 1e-12, 'lit share fell at cycle ' + Step / 100);
        Previous = Share;
    }
    assert.equal(LitShare(0.45), 1, 'the whole fibre is lit by 45 %');
});

test('Sweep holds one plateau from 45 % to 75 % of the cycle, at 65 % of full at the start of the fibre', () => {
    for (let Step = 0; Step <= 100; Step++) {
        const Position = Step / 100;
        assert.ok(Math.abs(SweepLevelAt(Position, 0.5) - SweepLevelAt(Position, 0.7)) < 1e-9, 'plateau at position ' + Position);
    }
    assert.ok(Math.abs(SweepLevelAt(0, 0.5) - 0.65) < 1e-9, 'plateau level at the start of the fibre');
});

test('Sweep fades after its hold: half the plateau at 87.5 % of the cycle', () => {
    assert.ok(Math.abs(SweepLevelAt(0, 0.875) - 0.325) < 1e-9);
});

test('the front ridge is the brightest part of the sweep, so it reads as a light moving along the fibre', () => {
    const Cycle = 0.2;
    const Front = -0.03 + 1.06 * (Cycle / 0.45);
    let Brightest = 0;
    let BrightestAt = 0;
    for (let Step = 0; Step <= 400; Step++) {
        const Level = SweepLevelAt(Step / 400, Cycle);
        if (Level > Brightest) {
            Brightest = Level;
            BrightestAt = Step / 400;
        }
    }
    assert.ok(Math.abs(BrightestAt - (Front - 0.012)) <= 0.01, 'brightest at ' + BrightestAt.toFixed(3) + ', front ' + Front.toFixed(3));
    assert.ok(Brightest > 0.8, 'ridge peak ' + Brightest.toFixed(3));
});

test('a completed sweep has no step across the seam: the start and end of the fibre match', () => {
    for (let Step = 46; Step <= 95; Step++) {
        const Cycle = Step / 100;
        assert.ok(Math.abs(SweepLevelAt(0, Cycle) - SweepLevelAt(1, Cycle)) < 1e-9, 'seam step at cycle ' + Cycle);
    }
});

test('while the sweep runs, the lit part fades in from the seam rather than starting with a hard edge', () => {
    assert.equal(SweepLevelAt(0, 0.2), 0, 'nothing is lit at the seam before the fade');
    assert.ok(SweepLevelAt(0.04, 0.2) > SweepLevelAt(0.01, 0.2), 'the fade rises away from the seam');
    assert.ok(Math.abs(SweepLevelAt(0.04, 0.2) - 0.65) < 1e-9, 'the fade is complete within 4 % of the fibre');
});
