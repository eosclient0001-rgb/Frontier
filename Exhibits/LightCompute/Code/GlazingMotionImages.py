#============================================================================================================================================
#                                                         GLAZINGMOTIONIMAGES.PY
#============================================================================================================================================
# 🧩 Present actual six-pose native Vulkan readbacks; no invented intermediate frames or synthesized imagery.
from pathlib import Path
import hashlib
import json
import sys
Root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Root / '_ClaudeScratch/tmp/MaterialTools'))
from PIL import Image, ImageDraw
Capture = Root / '_ClaudeScratch/glazing-motion'
Images = Root / 'Exhibits/LightCompute/Images'
Results = Root / 'Exhibits/LightCompute/Results'
Canvas = Image.new('RGB', (576, 304), '#151b23')
Draw = ImageDraw.Draw(Canvas)
Frames = []
Hashes = {}
for Pose in range(6):
    Source = Capture / f'GlazingMotion{Pose}.ppm'
    Picture = Image.open(Source).convert('RGB')
    assert Picture.size == (192, 120)
    Picture.save(Images / f'GlazingMotion{Pose}.png')
    X, Y = (Pose % 3)*192, (Pose // 3)*144
    Canvas.paste(Picture, (X, Y+24))
    Draw.text((X+6, Y+6), f'Pose {Pose} / angle {Pose*.08:.2f}', fill='#eef2f8')
    Frame = Image.new('RGB', (384, 264), '#151b23')
    Frame.paste(Picture.resize((384, 240), Image.Resampling.NEAREST), (0, 24))
    ImageDraw.Draw(Frame).text((8, 7), f'Native Vulkan / pose {Pose} / 192 x 120 / CPU', fill='#eef2f8')
    Frames.append(Frame)
    Hashes[Source.name] = hashlib.sha256(Source.read_bytes()).hexdigest()
Draw.text((6, 291), 'Actual six poses, stepped motion; camera cut at pose 3. 16 samples; no glass denoising.', fill='#b9c8db')
Canvas.save(Images / 'GlazingMotion.png')
Frames[0].save(Images / 'GlazingMotion.gif', save_all=True, append_images=Frames[1:], duration=450,
               loop=0, disposal=2, optimize=False)
for Name in ['GlazingMotionWarm', 'GlazingMotionEmission']:
    Source = Capture / (Name + '.ppm')
    Image.open(Source).save(Images / (Name + '.png'))
    Hashes[Source.name] = hashlib.sha256(Source.read_bytes()).hexdigest()
Report = {'device': 'SwiftShader Device (Subzero)', 'physical_gpu': False, 'source_dimensions': [192, 120],
          'samples_per_pixel': 16, 'interaction_cap': 2048, 'poses': 6, 'glass_triangles': 284,
          'glass_token': 100700, 'moving_mirror_token': 100301, 'mirror_triangles': 4,
          'capture_sha256': Hashes,
          'source_archive_sha256': {f'VehicleMotion{I}.bin': hashlib.sha256(
              (Root / f'_ClaudeScratch/primary-motion/VehicleMotion{I}.bin').read_bytes()).hexdigest() for I in range(6)},
          'logs': {N: (Results / (N + '.txt')).read_text() for N in
                   ['GlazingMotionNative', 'GlazingMotionSanitized', 'GlazingMotionAuthoring', 'GlazingMotionGpu']},
          'scope': 'Actual native closed-glass six-pose captures. Conservative indirect geometry resets; directional glass remains fresh. Not a glass denoiser, real-time simulation, editor importer or physical GPU acceptance.'}
(Results / 'GlazingMotion.json').write_text(json.dumps(Report, indent=2) + '\n')
print('GLAZING_MOTION_IMAGES frames=6 dimensions=192x120 software_vulkan=1 interpolation=0')
