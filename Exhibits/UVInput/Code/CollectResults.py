#============================================================================================================================================
#                                                          COLLECTRESULTS.PY
#============================================================================================================================================
# 🧩 Retain executed wheel-validation logs, decoded screenshot digests, and compiler/profile evidence.

from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import platform
import re
import shutil
import subprocess
import xml.etree.ElementTree as Xml

from PIL import Image

RepositoryRoot = Path(__file__).resolve().parents[3]
ExhibitRoot = RepositoryRoot / 'Exhibits/UVInput'
LogRoot = RepositoryRoot / '_ClaudeScratch/logs'


def InspectTestResults(ProfileName, FileName, WheelLogName):
    Suite = Xml.parse(ExhibitRoot / 'Results' / FileName).getroot()
    Tests = list(Suite.iter('testcase'))
    Failures = [Test.attrib['name'] for Test in Tests if Test.find('failure') is not None or Test.find('error') is not None]
    Skipped = [Test.attrib['name'] for Test in Tests if Test.find('skipped') is not None]
    # CTest truncates successful JUnit stdout at 1024 bytes; retain the separate complete focused run as well.
    WheelOutput = (ExhibitRoot / 'Results' / WheelLogName).read_text()
    AssertionMatch = re.search(r'RESULT (\d+)/(\d+) assertions passed', WheelOutput)
    if AssertionMatch is None:
        raise RuntimeError('Missing full wheel assertion result in ' + WheelLogName)
    PassedAssertions, TotalAssertions = map(int, AssertionMatch.groups())
    WheelPassed = PassedAssertions == TotalAssertions and '[FAIL]' not in WheelOutput
    return {
        'Profile': ProfileName,
        'TestCount': len(Tests),
        'FailedTests': Failures,
        'SkippedTests': Skipped,
        'WheelAssertionsPassed': PassedAssertions,
        'WheelAssertionCount': TotalAssertions,
        'WheelOutput': WheelOutput,
        'Result': 'PASS' if not Failures and not Skipped and WheelPassed else 'FAIL',
    }


def CompressCapture(FilePath):
    with Image.open(FilePath) as SourceImage:
        DecodedImage = SourceImage.convert('RGBA')
    DecodedDigest = hashlib.sha256(DecodedImage.tobytes()).hexdigest()
    DecodedImage.save(FilePath, optimize=True, compress_level=9)
    with Image.open(FilePath) as VerifiedImage:
        if hashlib.sha256(VerifiedImage.convert('RGBA').tobytes()).hexdigest() != DecodedDigest:
            raise RuntimeError('PNG compression changed captured pixels: ' + str(FilePath))
    return {
        'Path': FilePath.relative_to(RepositoryRoot).as_posix(),
        'Width': DecodedImage.width,
        'Height': DecodedImage.height,
        'DecodedRgbaSha256': DecodedDigest,
        'PngSha256': hashlib.sha256(FilePath.read_bytes()).hexdigest(),
    }


def Main():
    ResultsRoot = ExhibitRoot / 'Results'
    ResultsRoot.mkdir(parents=True, exist_ok=True)
    Logs = {
        'uv-development-tests.txt': 'Development.txt',
        'uv-editor-sanitized-tests.txt': 'EditorSanitized.txt',
        'uv-editor-sanitized-build.txt': 'EditorSanitizedBuild.txt',
        'uv-final-build.txt': 'DevelopmentBuild.txt',
        'uv-html-tests.txt': 'HtmlReference.txt',
        'uv-wheel-development.txt': 'WheelDevelopment.txt',
        'uv-wheel-editor-sanitized.txt': 'WheelEditorSanitized.txt',
    }
    for SourceName, DestinationName in Logs.items():
        shutil.copyfile(LogRoot / SourceName, ResultsRoot / DestinationName)
    shutil.copyfile(
        RepositoryRoot / 'Exhibits/Images/UV/FrontierUV_DesktopExecutable.png',
        ExhibitRoot / 'Images/NativeApplication.png')
    Captures = [CompressCapture(ExhibitRoot / 'Images' / FileName)
                for FileName in ('Before.png', 'After.png', 'NativeApplication.png')]
    Profiles = [
        InspectTestResults('Development / Debug', 'Development.xml', 'WheelDevelopment.txt'),
        InspectTestResults(
            'Editor / Debug / AddressSanitizer + UndefinedBehaviorSanitizer',
            'EditorSanitized.xml', 'WheelEditorSanitized.txt'),
    ]
    Compiler = subprocess.check_output(['c++', '--version'], text=True).splitlines()[0]
    Summary = {
        'DateUtc': datetime.now(timezone.utc).isoformat(),
        'Environment': {
            'OperatingPlatform': platform.platform(),
            'Compiler': Compiler,
            'Python': platform.python_version(),
            'WindowPlatform': 'GLFW 3.4 null platform; installed scroll callback replay',
            'Rendering': 'production Vulkan UV rasterizer on bundled SwiftShader; ImGui exhibit composite',
            'SanitizerOptions': 'ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1',
            'SanitizerLimit': 'leak detection disabled globally because of external Vulkan-driver allocations',
        },
        'Profiles': Profiles,
        'Captures': Captures,
        'WindowsRuntimeVerified': False,
        'PhysicalMouseVerified': False,
        'GitHubActionsRun': False,
        'WorkingSourceDigests': {
            RelativePath: hashlib.sha256((RepositoryRoot / RelativePath).read_bytes()).hexdigest()
            for RelativePath in (
                'Engine/Lifecycle/DesktopWorkspaceLaunch.cpp',
                'Exhibits/UVInput/Code/WheelInputValidation.cpp',
                'Automation/UVWorkspace.cmake',
                'CMakeLists.txt',
            )
        },
    }
    (ResultsRoot / 'Summary.json').write_text(json.dumps(Summary, indent=2) + '\n')
    for Profile in Profiles:
        print('{0}: {1}, {2} tests'.format(Profile['Profile'], Profile['Result'], Profile['TestCount']))
    if any(Profile['Result'] != 'PASS' for Profile in Profiles):
        raise SystemExit(1)


if __name__ == '__main__':
    Main()
