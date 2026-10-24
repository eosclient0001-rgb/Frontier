"""Hash reference sources/readbacks without inferring GPU or Windows execution."""
from pathlib import Path
import hashlib
import json
Root = Path(__file__).resolve().parents[3]
Exhibit = Root / 'Exhibits/VehicleReference'
Sources = list((Root / 'Frontier/Engine/Rendering').glob('*.h'))
Sources += list((Root / 'Frontier/Engine/Rendering').glob('*.cpp'))
Sources += [Pathname for Pathname in Exhibit.rglob('*') if Pathname.is_file() and
            (Pathname.suffix in ('.cpp', '.py', '.mjs', '.md', '.ps1', '.sh') or Pathname.name == 'CMakeLists.txt')]
Archive = Root / 'Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds'
Sources += list((Archive / 'Archive').glob('ControlVehicle*.facet'))
Sources += [Archive / 'Source/MaterialSpecification.js', Archive / 'Source/VehicleSpecification.js']
Products = list((Exhibit / 'Capture').glob('*.png')) + list(Exhibit.glob('*Results.txt'))
Products += [Exhibit / 'RegressionBefore.txt']
def Hashes(Paths):
    return {str(Pathname.relative_to(Root)): hashlib.sha256(Pathname.read_bytes()).hexdigest()
            for Pathname in sorted(set(Paths))}
Report = {'rendering_path': 'native C++ CPU reference', 'physical_gpu_verified': False,
          'vulkan_executed': False, 'windows_executed': False, 'poses': 3, 'extent': [640, 400],
          'vehicle_facets': 25068, 'accumulation_frames_per_pose': 8,
          'cross_pose_history_verified': False, 'sources_sha256': Hashes(Sources), 'products_sha256': Hashes(Products)}
(Exhibit / 'Manifest.json').write_text(json.dumps(Report, indent=2) + '\n')
print(f'Evidence: {len(Report["sources_sha256"])} sources, {len(Report["products_sha256"])} products; CPU reference only')
