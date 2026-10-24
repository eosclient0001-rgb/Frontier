"""Hash sources, actual compiled Slang and readbacks; distinguish software Vulkan from physical GPU execution."""
from pathlib import Path
import hashlib
import json
import platform
import re
Root = Path(__file__).resolve().parents[3]
Output = Root / 'Exhibits/LightCompute'
Sources = list((Root / 'Frontier/Engine/Rendering').glob('*.h'))
Sources += list((Root / 'Frontier/Engine/Rendering').glob('*.cpp'))
Sources += list((Root / 'Frontier/Engine/Diagnostics').glob('*.h'))
Sources += list((Root / 'Frontier/Engine/Diagnostics').glob('*.cpp'))
Sources += [Root / 'Frontier/Engine/Rendering/Shaders/LightInfluence.slang']
Sources += [P for P in Output.rglob('*') if P.suffix in ('.h', '.cpp', '.py', '.sh', '.ps1', '.md') or P.name == 'CMakeLists.txt']
Sources += [Root / 'Exhibits/VehicleReference' / P for P in ('Code/VehicleCapture.cpp', 'Code/Materials.mjs', 'CMakeLists.txt')]
Sources += [Root / 'Exhibits/ClusteredLighting/Fixtures/Synthetic.ies']
Sources += list((Root / 'Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds/Archive').glob('ControlVehicle*.facet'))
Sources += [Root / 'Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds/Source' / P
            for P in ('MaterialSpecification.js', 'VehicleSpecification.js')]
Products = list((Output / 'Images').glob('*.png')) + list((Output / 'Results').glob('*.txt'))
Products += [Output / 'Results/Images.json', Output / 'Results/History.json', Output / 'Results/PrimaryMotion.json', Output / 'Results/Transport.json', Output / 'Results/Emissive.json']
def Hashes(Paths):
    return {str(P.relative_to(Root)): hashlib.sha256(P.read_bytes()).hexdigest() for P in sorted(set(Paths))}
Log = (Output / 'Results/Vulkan.txt').read_text()
DeviceLine = Log.splitlines()[0]
DeviceType = int(re.search(r' type=(\d+)', DeviceLine).group(1))
Report = {'execution': 'actual Vulkan compute with shared Slang', 'device': DeviceLine,
          'device_type': DeviceType, 'software_vulkan_executed': DeviceType == 4,
          'platform': platform.platform(), 'vulkan_executed': True, 'physical_gpu_executed': DeviceType in (1, 2),
          'ray_query_executed': False, 'triangle_bvh_shader_executed': True,
          'native_direct_upload_poisoned': True,
          'primary_visibility': 'Vulkan camera rays for Primary.png; native CPU raster for history regression',
          'gpu_primary_visibility_executed': True, 'primary_receiver_channels_poisoned': 36,
          'primary_sky_and_indirect': 'black environment; no indirect transport',
          'sky_and_indirect': 'native CPU reference in retained history regression',
          'gpu_fresh_ris_executed': True, 'gpu_temporal_reuse_executed': True,
          'gpu_spatial_reuse_executed': True, 'gpu_filtering_executed': True,
          'rigid_motion_reprojection_executed': 'MOTION index=' in Log,
          'gpu_primary_motion_reprojection_executed': True,
          'gpu_primary_motion_native_metadata_oracle': True,
          'gpu_one_bounce_diffuse_transport_executed': True,
          'atmosphere_cube_bake': 'native CPU SingleScattering, consumed by shader',
          'gpu_atmosphere_executed': False,
          'transport_native_probes': 901,
          'gpu_emissive_area_sampling_executed': True,
          'emissive_native_probes': 225,
          'emissive_high_reference_samples': 8192,
          'windows_executed': False, 'vulkan_validation_layer_executed': False,
          'sources_sha256': Hashes(Sources), 'products_sha256': Hashes(Products),
          'scratch_sha256': Hashes(list((Root / '_ClaudeScratch/build/light-compute').glob('*.spv')) +
                                   [Root / '_ClaudeScratch/vehicle-reference/VehicleLightInput.bin',
                                    Root / '_ClaudeScratch/vehicle-primary/VehiclePrimary.bin',
                                    Root / '_ClaudeScratch/light-compute/TransportScene.bin',
                                    Root / '_ClaudeScratch/light-compute/EmissiveScene.bin'] +
                                   list((Root / '_ClaudeScratch/vehicle-reference').glob('VehicleMotion*.bin')) +
                                   list((Root / '_ClaudeScratch/primary-motion').glob('VehicleMotion*.bin')))}
(Output / 'Results/Manifest.json').write_text(json.dumps(Report, indent=2) + '\n')
print('Evidence:', len(Report['sources_sha256']), 'sources;', len(Report['products_sha256']), 'products; device type', DeviceType)
