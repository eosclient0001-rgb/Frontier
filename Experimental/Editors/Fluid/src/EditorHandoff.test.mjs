import test from 'node:test';
import assert from 'node:assert/strict';
import { InstallEditorHandoff } from './EditorHandoff.js';

test('handoff accepts only the same-origin parent and returns edits without echoing intake', () => {
  const Sent = [], Parent = { postMessage: (...Args) => Sent.push(Args) };
  let Receive;
  const Host = { parent: Parent, location: { origin: 'https://editor.example' }, addEventListener: (_, Callback) => { Receive = Callback; } };
  const Panel = {
    Parameters: { emitterRate: 1 },
    ApplyParameter(Key, Value) { this.Parameters[Key] = Value; this.NotifyHandoff(); },
    SetHandoffName(Name) { this.Name = Name; },
  };
  InstallEditorHandoff(Panel, Host);
  const Data = { Frontier: 'gas-scene', Name: 'Fire', Settings: { emitterRate: 2, unknown: 3 } };
  Receive({ source: {}, origin: Host.location.origin, data: Data });
  Receive({ source: Parent, origin: 'https://other.example', data: Data });
  assert.equal(Panel.Parameters.emitterRate, 1);
  Receive({ source: Parent, origin: Host.location.origin, data: Data });
  assert.deepEqual(Panel.Parameters, { emitterRate: 2 });
  assert.equal(Panel.Name, 'Fire');
  assert.equal(Sent.length, 0);
  Panel.ApplyParameter('emitterRate', 3);
  assert.deepEqual(Sent, [[{ Frontier: 'gas-scene-changed', Settings: { emitterRate: 3 } }, Host.location.origin]]);
});
