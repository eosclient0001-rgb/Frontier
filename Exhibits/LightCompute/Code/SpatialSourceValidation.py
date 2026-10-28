#!/usr/bin/env python3
# 🧩 Execute the retained spatial WGSL on a two-receiver, finite-domain fixture.
import hashlib
import struct
from pathlib import Path

import numpy as np
import wgpu

Root = Path(__file__).resolve().parents[3]
Reference = Root / 'Experimental/VehicleHmiReference/Shader'
Spatial = (Reference / 'ReservoirSpatial.wgsl').read_text()
Records = (Reference / 'ReservoirRecords.wgsl').read_text()
Packing = (Reference / 'PackingCodec.wgsl').read_text()

# The scene and random disk proposals are deliberately controlled: both compatible surfaces coincide,
# and each pixel proposes the other. The actual reservoir structs, merge, target and spatial entry are unchanged.
Prelude = '''
struct FrameRecord {
    TraceScale: u32, ScreenExtent: vec2f, TraceExtent: vec2f, FrameIndex: u32,
    SpatialCount: u32, SpatialRadius: f32, SunIlluminance: vec3f,
}
const Frame = FrameRecord(1u, vec2f(2.0, 1.0), vec2f(2.0, 1.0), 0u, 1u, 1.0, vec3f(100.0));
const SkyIdentity = 0u;
const FeatureSpatialReuse = 1u;
const FeatureFireflyFilter = 2u;
const FeatureVisibilityReuse = 3u;
const FeatureRayTracing = 4u;
const RayEpsilon = 0.001;
fn FeatureEnabled(F: FrameRecord, Feature: u32) -> bool { return Feature == FeatureSpatialReuse; }
fn ReconstructWorldPosition(Pixel: vec2f, Depth: f32) -> vec3f { return vec3f(0.0); }
fn ConstructPixelSeed(Pixel: vec2u, Index: u32, Salt: u32) -> u32 { return Pixel.x; }
fn AdvanceUniform(Seed: ptr<function, u32>) -> f32 { return select(0.25, 0.75, (*Seed) == 1u); }
fn ProjectUniformDisk(Draw: vec2f) -> vec2f { return vec2f(select(1.0, -1.0, Draw.x > 0.5), 0.0); }
fn ResolveLuminance(Radiance: vec3f) -> f32 { return dot(Radiance, vec3f(0.2126, 0.7152, 0.0722)); }
fn TraceSceneVisibility(Origin: vec3f, Direction: vec3f, Start: f32, Reach: f32) -> f32 { return 1.0; }
fn TraverseSceneVisibility(Origin: vec3f, Direction: vec3f, Start: f32, Reach: f32) -> f32 { return 1.0; }
fn ResolveSurfaceBias(Position: vec3f) -> f32 { return 0.001; }
'''

# Counterfactual only: retain a geometrically eligible zero-weight donor's domain for Z.
# It is NOT presented as a general production fix for reconnection or visibility.
Needle = 'if (Reservoir.Tally <= 0.0 || Reservoir.Weight <= 0.0)'
assert Spatial.count(Needle) == 1
Alternative = Spatial.replace(Needle, 'if (Reservoir.Tally <= 0.0)')
Needle = '            let Jacobian = ResolveReconnectionJacobian(Reservoir.Sample, Position, DonorPosition);'
assert Alternative.count(Needle) == 1
Alternative = Alternative.replace(Needle, '''            if (Reservoir.Weight <= 0.0)
            {
                DonorPositions[DonorCount] = DonorPosition;
                DonorNormals[DonorCount] = DonorNormal;
                DonorTallies[DonorCount] = Reservoir.Tally;
                DonorCount++;
                continue;
            }
''' + Needle)


def Reservoir(Bright, Probability):
    Radiance = 1.0 if Bright else 0.0
    Rg = int.from_bytes(struct.pack('<ee', Radiance, Radiance), 'little')
    Bi = int.from_bytes(struct.pack('<ee', Radiance, 0.0), 'little')
    return struct.pack('<3fI2I2f', 0, 0, 10000, 0, Rg, Bi, 1 / Probability if Bright else 0, 1)


def main():
    Adapter = wgpu.gpu.request_adapter_sync(power_preference='low-power')
    Device = Adapter.request_device_sync()
    print('ADAPTER', Adapter.info, flush=True)
    for Name, Source in (('original', Spatial), ('retained-domain counterfactual', Alternative)):
        Module = Device.create_shader_module(code=Prelude + Packing + Records + Source)
        Pipeline = Device.create_compute_pipeline(layout='auto', compute={'module': Module, 'entry_point': 'ResampleSpatial'})
        Guide = Device.create_texture(size=(2, 1, 1), format='rgba16float', usage=wgpu.TextureUsage.TEXTURE_BINDING | wgpu.TextureUsage.COPY_DST)
        Device.queue.write_texture({'texture': Guide}, np.array([0, 0, 1, 1] * 2, dtype=np.float16).tobytes(),
                                   {'bytes_per_row': 16, 'rows_per_image': 1}, (2, 1, 1))
        Depth = Device.create_texture(size=(2, 1, 1), format='depth32float', usage=wgpu.TextureUsage.TEXTURE_BINDING | wgpu.TextureUsage.RENDER_ATTACHMENT)
        Output = Device.create_texture(size=(2, 1, 1), format='rgba16float', usage=wgpu.TextureUsage.STORAGE_BINDING | wgpu.TextureUsage.COPY_SRC)
        for Probability in (0.5, 0.125, 0.0625):
            Mean = 0.0
            Cases = []
            for Own in (False, True):
                for Donor in (False, True):
                    Packed = Reservoir(Own, Probability) + Reservoir(Donor, Probability)
                    Buffer = Device.create_buffer_with_data(data=Packed, usage=wgpu.BufferUsage.STORAGE)
                    Group = Device.create_bind_group(layout=Pipeline.get_bind_group_layout(0), entries=[
                        {'binding': 1, 'resource': Guide.create_view()}, {'binding': 2, 'resource': Depth.create_view()},
                        {'binding': 3, 'resource': {'buffer': Buffer}}, {'binding': 4, 'resource': Output.create_view()}])
                    Encoder = Device.create_command_encoder()
                    Render = Encoder.begin_render_pass(color_attachments=[], depth_stencil_attachment={
                        'view': Depth.create_view(), 'depth_load_op': 'clear', 'depth_store_op': 'store', 'depth_clear_value': 1.0})
                    Render.end()
                    Compute = Encoder.begin_compute_pass()
                    Compute.set_pipeline(Pipeline)
                    Compute.set_bind_group(0, Group)
                    Compute.dispatch_workgroups(1, 1, 1)
                    Compute.end()
                    Device.queue.submit([Encoder.finish()])
                    Raw = Device.queue.read_texture({'texture': Output}, {'bytes_per_row': 16, 'rows_per_image': 1}, (2, 1, 1))
                    Rgb = np.frombuffer(Raw, dtype=np.float16).reshape(2, 4)[0, :3].astype(float)
                    assert np.allclose(Rgb, Rgb[0], atol=0.001), Rgb
                    Radiance = Rgb[0]
                    Cases.append(float(Radiance))
                    Mean += (Probability if Own else 1 - Probability) * (Probability if Donor else 1 - Probability) * Radiance
            Expected = 1 + (1 - Probability) / 2 if Name == 'original' else 1
            assert abs(Mean - Expected) < 1e-5, (Name, Probability, Cases, Mean, Expected)
            print(f'{Name} p={Probability:g} outputs={Cases} weighted_mean={Mean:.8g} reference=1', flush=True)
    for Pathname in ('PackingCodec.wgsl', 'ReservoirRecords.wgsl', 'ReservoirSpatial.wgsl'):
        print(Pathname, hashlib.sha256((Reference / Pathname).read_bytes()).hexdigest())
    print('PASS finite-domain WGSL execution; not a full browser scene, native GI parity or timing comparison')


if __name__ == '__main__':
    main()
