//============================================================================================================================================
//                                                             INSPECTORPANEL.JS
//============================================================================================================================================
// 📦 Builds grouped DOM controls from schema fields and writes every edit back through accessors.

import { CoerceField } from './SceneModel.js';

// 📝 Accessors: Read(Definition) returns the stored value, Write(Definition, Value) stores the coerced value, and the
//    optional Changed() lets the shell refresh anything that summarises the edit (the layer list, the cost note).
export function BuildInspector(Container, Fields, Accessors) {
    Container.textContent = '';
    const Groups = new Map();
    for (const Definition of Fields) {
        if (!Groups.has(Definition.Group)) {
            const Panel = document.createElement('details');
            Panel.className = 'InspectorGroup';
            Panel.open = true;
            const Heading = document.createElement('summary');
            Heading.textContent = Definition.Group;
            Panel.append(Heading);
            Container.append(Panel);
            Groups.set(Definition.Group, Panel);
        }
        Groups.get(Definition.Group).append(BuildControl(Definition, Accessors));
    }
}

function Commit(Definition, Accessors, Raw) {
    Accessors.Write(Definition, CoerceField(Definition, Raw));
    if (Accessors.Changed) Accessors.Changed();
}

function BuildControl(Definition, Accessors) {
    const Row = document.createElement('div');
    Row.className = 'Row';
    const Caption = document.createElement('span');
    Caption.className = 'Caption';
    Caption.textContent = Definition.Label;
    Row.append(Caption);
    const Current = Accessors.Read(Definition);
    switch (Definition.Kind) {
        case 'Number':
        case 'Integer':
            Row.append(NumberControl(Definition, Accessors));
            break;
        case 'Colour': {
            const Input = document.createElement('input');
            Input.type = 'color';
            Input.value = Current;
            Input.addEventListener('input', () => Commit(Definition, Accessors, Input.value));
            Row.append(Input);
            break;
        }
        case 'Vector':
            Row.append(VectorControl(Definition, Accessors));
            break;
        case 'Choice': {
            const Select = document.createElement('select');
            for (const Choice of Definition.Choices) {
                const Option = document.createElement('option');
                Option.value = Choice;
                Option.textContent = Choice;
                Option.selected = Choice === Current;
                Select.append(Option);
            }
            Select.addEventListener('change', () => Commit(Definition, Accessors, Select.value));
            Row.append(Select);
            break;
        }
        case 'Toggle': {
            const Box = document.createElement('input');
            Box.type = 'checkbox';
            Box.checked = Current;
            Box.addEventListener('change', () => Commit(Definition, Accessors, Box.checked));
            Row.append(Box);
            break;
        }
        case 'Text': {
            const Input = document.createElement('input');
            Input.type = 'text';
            Input.maxLength = Definition.MaxLength;
            Input.value = Current;
            Input.addEventListener('input', () => Commit(Definition, Accessors, Input.value));
            Row.append(Input);
            break;
        }
        default:
            break;
    }
    return Row;
}

function NumberControl(Definition, Accessors) {
    const Wrap = document.createElement('div');
    Wrap.className = 'Pair';
    const Current = Accessors.Read(Definition);
    const Slider = document.createElement('input');
    Slider.type = 'range';
    Slider.min = Definition.Min;
    Slider.max = Definition.Max;
    Slider.step = Definition.Step;
    Slider.value = Current;
    const Entry = document.createElement('input');
    Entry.type = 'number';
    Entry.min = Definition.Min;
    Entry.max = Definition.Max;
    Entry.step = Definition.Step;
    Entry.value = Current;
    Slider.addEventListener('input', () => {
        Commit(Definition, Accessors, Number(Slider.value));
        Entry.value = Accessors.Read(Definition);
    });
    Entry.addEventListener('change', () => {
        Commit(Definition, Accessors, Number(Entry.value));
        Entry.value = Accessors.Read(Definition);
        Slider.value = Accessors.Read(Definition);
    });
    Wrap.append(Slider, Entry);
    return Wrap;
}

function VectorControl(Definition, Accessors) {
    const Wrap = document.createElement('div');
    Wrap.className = 'Vector';
    const Names = Definition.Key.endsWith('Rotation') ? ['Yaw', 'Pitch', 'Roll'] : ['X', 'Y', 'Z'];
    Names.forEach((Name, Index) => {
        const Entry = document.createElement('input');
        Entry.type = 'number';
        Entry.step = Definition.Step;
        Entry.min = Definition.Min;
        Entry.max = Definition.Max;
        Entry.title = Definition.Label + ' ' + Name;
        Entry.value = Accessors.Read(Definition)[Index];
        Entry.addEventListener('change', () => {
            const Next = Accessors.Read(Definition).slice();
            Next[Index] = Number(Entry.value);
            Commit(Definition, Accessors, Next);
            Entry.value = Accessors.Read(Definition)[Index];
        });
        Wrap.append(Entry);
    });
    return Wrap;
}
