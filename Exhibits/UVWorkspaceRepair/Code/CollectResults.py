#============================================================================================================================================
#                                                          COLLECTRESULTS.PY
#============================================================================================================================================
# 🧩 Retain complete native UV regression results, exact source digests and losslessly compressed Vulkan capture evidence.

from pathlib import Path
import hashlib
import json
import platform
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as Xml

from PIL import Image, ImageDraw, ImageFont

RepositoryRoot = Path(__file__).resolve().parents[3]
ExhibitRoot = RepositoryRoot / 'Exhibits/UVWorkspaceRepair'
LogRoot = RepositoryRoot / '_ClaudeScratch/logs'
ResultsRoot = ExhibitRoot / 'Results'


def InspectAssertions(Filename, Pattern):
    Text = (ResultsRoot / Filename).read_text()
    Match = re.search(Pattern, Text)
    if Match is None or '[FAIL]' in Text or 'ERROR: AddressSanitizer' in Text or 'runtime error:' in Text:
        raise RuntimeError('Missing or failed focused validation: ' + Filename)
    Passed, Total = map(int, Match.groups())
    if Passed != Total:
        raise RuntimeError('Focused assertions failed: ' + Filename)
    return {'Passed': Passed, 'Total': Total, 'Log': Filename}


def InspectProfile(Profile, Suffix):
    Suite = Xml.parse(ResultsRoot / (Suffix + '.xml')).getroot()
    Tests = list(Suite.iter('testcase'))
    Failed = [Test.attrib['name'] for Test in Tests if Test.find('failure') is not None or Test.find('error') is not None]
    Skipped = [Test.attrib['name'] for Test in Tests if Test.find('skipped') is not None]
    if len(Tests) != 19 or Failed or Skipped:
        raise RuntimeError('Native CTest suite is not fully passing: ' + Profile)
    return {
        'Profile': Profile,
        'CTestCount': len(Tests),
        'FailedTests': Failed,
        'SkippedTests': Skipped,
        'Wheel': InspectAssertions('Wheel' + Suffix + '.txt', r'RESULT (\d+)/(\d+) assertions passed'),
        'Rendering': InspectAssertions('Rendering' + Suffix + '.txt', r'WorkspaceRepairValidation: (\d+)/(\d+) assertions passed'),
        'Interaction': InspectAssertions('Interaction' + Suffix + '.txt', r'WorkspaceInteractionValidation: (\d+)/(\d+) assertions passed'),
        'FullEditorInputOwnershipExecuted': Suffix == 'EditorSanitized',
    }


def CompressCapture(Filename):
    with Image.open(Filename) as Source:
        Pixels = Source.convert('RGBA')
    Digest = hashlib.sha256(Pixels.tobytes()).hexdigest()
    Pixels.save(Filename, optimize=True, compress_level=9)
    with Image.open(Filename) as Verified:
        if hashlib.sha256(Verified.convert('RGBA').tobytes()).hexdigest() != Digest:
            raise RuntimeError('PNG recompression changed captured pixels: ' + str(Filename))
    return {
        'Path': Filename.relative_to(RepositoryRoot).as_posix(),
        'Width': Pixels.width,
        'Height': Pixels.height,
        'DecodedRgbaSha256': Digest,
        'PngSha256': hashlib.sha256(Filename.read_bytes()).hexdigest(),
    }


def ConstructComparison():
    CellWidth = 246
    CellHeight = 290
    Canvas = Image.new('RGB', (CellWidth * 5, CellHeight * 2 + 46), '#101113')
    Ink = ImageDraw.Draw(Canvas)
    FontPath = RepositoryRoot / 'EngineContent/FontsArchives/DMSans/DMSans-Regular.ttf'
    Font = ImageFont.truetype(str(FontPath), 13) if FontPath.exists() else ImageFont.load_default()
    Ink.text((12, 12), 'Actual production Vulkan readbacks - flat-panel MatCaps, not generated illustrations', fill='#eff4cf', font=Font)
    Labels = [(7, 'Zebra'), (10, 'Blue metallic flakes'), (11, 'Red metallic flakes'), (12, 'Carbon fibre'), (13, 'Woven fabric')]
    for Row, Folder in enumerate(('Before', 'After')):
        for Column, (Slot, Label) in enumerate(Labels):
            OriginX = Column * CellWidth
            OriginY = 46 + Row * CellHeight
            with Image.open(ExhibitRoot / 'Images' / Folder / ('MatCap' + str(Slot) + '.png')) as Source:
                Capture = Source.convert('RGB').resize((CellWidth, CellWidth), Image.Resampling.NEAREST)
            Canvas.paste(Capture, (OriginX, OriginY))
            Ink.text((OriginX + 10, OriginY + CellWidth + 5), Folder + ' - ' + Label, fill='#e4e8f0', font=Font)
    Canvas.save(ExhibitRoot / 'Images/MatCapComparison.png', optimize=True)


def Main():
    ResultsRoot.mkdir(parents=True, exist_ok=True)
    Logs = {
        'uv-repair-development-build.txt': 'DevelopmentBuild.txt',
        'uv-repair-development.txt': 'Development.txt',
        'uv-repair-development.xml': 'Development.xml',
        'uv-repair-editor-build.txt': 'EditorSanitizedBuild.txt',
        'uv-repair-editor.txt': 'EditorSanitized.txt',
        'uv-repair-editor.xml': 'EditorSanitized.xml',
        'uv-repair-wheel-development.txt': 'WheelDevelopment.txt',
        'uv-repair-wheel-editor.txt': 'WheelEditorSanitized.txt',
        'uv-repair-render-development.txt': 'RenderingDevelopment.txt',
        'uv-repair-render-editor.txt': 'RenderingEditorSanitized.txt',
        'uv-repair-interaction-development.txt': 'InteractionDevelopment.txt',
        'uv-repair-interaction-editor.txt': 'InteractionEditorSanitized.txt',
        'uv-repair-html.txt': 'HTML.txt',
    }
    for SourceName, DestinationName in Logs.items():
        shutil.copyfile(LogRoot / SourceName, ResultsRoot / DestinationName)
    Profiles = [InspectProfile('Development / Debug', 'Development'),
                InspectProfile('Editor / Debug / ASan + UBSan', 'EditorSanitized')]
    Html = (ResultsRoot / 'HTML.txt').read_text()
    if 'ALL UV STUDIO VALIDATIONS PASSED SUCCESSFULLY.' not in Html:
        raise RuntimeError('HTML reference validation did not complete all groups')
    subprocess.run([sys.executable, str(ExhibitRoot / 'Code/InspectContinuation.py')], cwd=RepositoryRoot, check=True)
    Audit = json.loads((ResultsRoot / 'Continuation.json').read_text())
    for SourceName, DestinationName in (
        ('FrontierUV_DesktopExecutable.png', 'StandaloneApplication.png'),
        ('FrontierEditor_DesktopExecutable.png', 'FullEditorApplication.png'),
    ):
        shutil.copyfile(RepositoryRoot / 'Exhibits/Images/UV' / SourceName,
                        ExhibitRoot / 'Images/After' / DestinationName)
    ConstructComparison()
    Captures = [CompressCapture(Filename) for Filename in sorted((ExhibitRoot / 'Images').rglob('*.png'))]
    Sources = Audit['ModifiedPaths'] + [
        'EngineContent/Geometry/ControlledIntegrator.GeometrySpace',
        'Exhibits/UVWorkspaceRepair/Code/WorkspaceRepairValidation.cpp',
        'Exhibits/UVWorkspaceRepair/Code/WorkspaceInteractionValidation.cpp',
        'Exhibits/UVInput/Code/WheelInputValidation.cpp',
        'Automation/UVWorkspace.cmake', 'CMakeLists.txt', '.github/workflows/windows-uv-build.yml',
    ]
    SourceDigests = {Name: hashlib.sha256((RepositoryRoot / Name).read_bytes()).hexdigest() for Name in sorted(Sources)}
    Combined = hashlib.sha256(json.dumps(SourceDigests, sort_keys=True).encode()).hexdigest()
    Summary = {
        'TaskDateUtc': '2026-11-12',
        'SessionBranch': subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip(),
        'LocalBuildBaseRevision': '96f31ecaef529d383e195013f5f00d163392f71a',
        'LocalTestedContents': 'Session base plus the source digests below; local tests ran before committing the repair',
        'SourceDigest': Combined,
        'Environment': {
            'Platform': platform.platform(),
            'Compiler': subprocess.check_output(['c++', '--version'], text=True).splitlines()[0],
            'Windowing': 'GLFW 3.4 null platform, installed production callback replay',
            'Rendering': 'Production Vulkan UV rasterizer and ImGui presenter on bundled SwiftShader CPU device',
            'Sanitizers': 'ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1',
            'SanitizerLimit': 'Leak checking disabled; address and undefined-behavior checking enabled',
        },
        'Profiles': Profiles,
        'HTMLValidationGroups': 11,
        'HTMLContentionControl': 'HTMLContended.txt retains the unchanged 50ms performance gate failing at 69.12ms during simultaneous builds',
        'ImportedPathCount': Audit['ImportedPathCount'],
        'UnchangedImportedPaths': Audit['IdenticalPathCount'],
        'ProtectedPathCount': len(Audit['ProtectedPaths']),
        'UDIMFilterConstructionIdentical': Audit['UDIMFilterConstructionIdentical'],
        'HistoricalVehicleIdentical': Audit['HistoricalVehicleIdentical'],
        'PhysicalWindowsInputVerified': False,
        'PhysicalMonitorDpiVerified': False,
        'PhysicalGpuVerified': False,
        'FramebufferScaleTest': 'Programmatically requested 1x/2x framebuffer scale, not physical monitor switching',
        'CaptureProfile': 'Final Editor / Debug / ASan + UBSan focused runs; HTML reference captured independently in Chromium',
        'HistoricalWheelEvidence': 'Exhibits/UVInput retained separately; five-change audit is historical, not the broader repair scope',
        'GitHubActionsEvidence': 'See Actions.json when the authorized remote run has completed',
        'WorkingSourceDigests': SourceDigests,
        'Captures': Captures,
    }
    (ResultsRoot / 'Summary.json').write_text(json.dumps(Summary, indent=2) + '\n')
    for Profile in Profiles:
        print(Profile['Profile'], ':', Profile['CTestCount'], 'CTests,',
              Profile['Interaction']['Passed'], 'interaction assertions,', Profile['Rendering']['Passed'], 'rendering assertions')
    print('Decoded pixels preserved for', len(Captures), 'captures. Source digest:', Combined)


if __name__ == '__main__':
    Main()
