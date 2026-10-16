// Only the visual pose. Dynamics, tyre pressure and compliance remain in VehicleSolver.
import { VehicleGeometry } from "./VehicleSpecification.js";

export const VehicleRecordBytes = 144; // five vec4 header fields + four vec4 wheel states
export function EncodeVehicleRecord(Header, Wheels)
{
    const Values = new Float32Array(VehicleRecordBytes / 4);
    const Cockpit = Header.Cockpit || { Anchor: [0, 0, 0], Scale: 1, Offset: [0, 0, 0] };
    Values.set([Header.SteeringAngle || 0, Header.SeeThroughGlass ? 1 : 0, 0, Header.Lamp || 0], 0);
    Values.set([...(Header.Column || [0, 0, 0]), 0], 4);
    Values.set([...(Header.Axis || [1, 0, 0]), 0], 8);
    Values.set([...Cockpit.Anchor, Cockpit.Scale], 12);
    Values.set([...Cockpit.Offset, 0], 16);
    for (let Index = 0; Index < 4; ++Index)
        Values.set([VehicleGeometry.TyreRadius, VehicleGeometry.TyreRimRadius, 0.5 * VehicleGeometry.TyreWidth,
                    Wheels[Index]?.Shredded ? 1 : 0], 20 + Index * 4);
    return Values;
}
