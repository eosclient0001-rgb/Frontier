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
Products += [Output / 'Results/Images.json']
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
          'primary_visibility': 'native CPU raster', 'sky_and_indirect': 'native CPU reference',
          'gpu_fresh_ris_executed': True, 'gpu_temporal_reuse_executed': False,
          'windows_executed': False, 'vulkan_validation_layer_executed': False,
          'sources_sha256': Hashes(Sources), 'products_sha256': Hashes(Products),
          'scratch_sha256': Hashes([Root / '_ClaudeScratch/build/light-compute/Cells.spv',
                                   Root / '_ClaudeScratch/build/light-compute/Receivers.spv',
                                   Root / '_ClaudeScratch/vehicle-reference/VehicleLightInput.bin'])}
(Output / 'Results/Manifest.json').write_text(json.dumps(Report, indent=2) + '\n')
print('Evidence:', len(Report['sources_sha256']), 'sources;', len(Report['products_sha256']), 'products; device type', DeviceType)
