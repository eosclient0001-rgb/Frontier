//============================================================================================================================================
//                                                           DISPLAYPANELCHECKS.MJS
//============================================================================================================================================
// 📦 Node checks for the display panel layout and hit testing. Rasterising and the pointer path are checked in the browser proof.

import assert from 'node:assert/strict';
import test from 'node:test';
import { DisplayPanel, PanelHeight, PanelWidth } from '../Source/DisplayPanel.js';

const Labels = Array.from({ length: 10 }, (Entry, Index) => 'Preset ' + (Index + 1));

test('the panel is the 16:10 tablet size', () => {
    assert.equal(PanelWidth, 1280);
    assert.equal(PanelHeight, 800);
});

test('ten preset toggles sit inside the panel, do not overlap and are centred', () => {
    const Panel = new DisplayPanel(Labels);
    assert.equal(Panel.Chips.length, 10);
    for (const Cell of Panel.Chips) {
        assert.ok(Cell.X >= 0 && Cell.X + Cell.Width <= PanelWidth, 'toggle ' + (Cell.Index + 1) + ' is inside the width');
        assert.ok(Cell.Y >= 0 && Cell.Y + Cell.Height <= PanelHeight, 'toggle ' + (Cell.Index + 1) + ' is inside the height');
    }
    for (let Index = 1; Index < Panel.Chips.length; Index++) {
        const Before = Panel.Chips[Index - 1];
        assert.ok(Panel.Chips[Index].X >= Before.X + Before.Width, 'toggles ' + Index + ' and ' + (Index + 1) + ' overlap');
    }
    const Last = Panel.Chips[9];
    assert.ok(Math.abs(Panel.Chips[0].X - (PanelWidth - (Last.X + Last.Width))) < 0.5, 'the toggle row is centred');
});

test('the slider spans the toggle row, sits below it and keeps its knob inside the panel', () => {
    const Panel = new DisplayPanel(Labels);
    const Last = Panel.Chips[9];
    assert.equal(Panel.TrackLeft, Panel.Chips[0].X);
    assert.equal(Panel.TrackRight, Last.X + Last.Width);
    const ChipBottom = Panel.Chips[0].Y + Panel.Chips[0].Height;
    assert.ok(Panel.LabelY > ChipBottom, 'the slider label is below the toggles');
    assert.ok(Panel.TrackY > Panel.LabelY, 'the track is below its label');
    assert.ok(Panel.TrackY + Panel.KnobRadius <= PanelHeight, 'the knob stays inside the panel');
});

test('hit testing returns the toggle under the pointer and nothing in the gaps or the title', () => {
    const Panel = new DisplayPanel(Labels);
    for (const Cell of Panel.Chips) {
        assert.deepEqual(Panel.HitTest(Cell.X + Cell.Width / 2, Cell.Y + Cell.Height / 2), { Action: 'Chip', Index: Cell.Index });
    }
    const Gap = Panel.Chips[0].X + Panel.Chips[0].Width + 7;
    assert.equal(Panel.HitTest(Gap, Panel.Chips[0].Y + 10), null, 'a gap between toggles');
    assert.equal(Panel.HitTest(Panel.TrackLeft, 150), null, 'the title area is not a control');
});

test('the slider maps each step to its preset and clamps outside the track', () => {
    const Panel = new DisplayPanel(Labels);
    for (let Index = 0; Index < Labels.length; Index++) {
        const X = Panel.TrackLeft + (Panel.TrackRight - Panel.TrackLeft) * (Index / (Labels.length - 1));
        assert.deepEqual(Panel.HitTest(X, Panel.TrackY), { Action: 'Slide', Index });
    }
    assert.equal(Panel.IndexAtX(-500), 0);
    assert.equal(Panel.IndexAtX(5000), 9);
    assert.equal(Panel.HitTest(Panel.TrackLeft, Panel.TrackY + 60), null, 'well below the track is not a control');
});
