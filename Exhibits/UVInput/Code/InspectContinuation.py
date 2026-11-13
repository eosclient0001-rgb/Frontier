#============================================================================================================================================
#                                                         INSPECTCONTINUATION.PY
#============================================================================================================================================
# 🧩 Compare recovered UV sources with their pinned Git blobs and retain the exact native input repair.

from pathlib import Path
import difflib
import hashlib
import json
import subprocess

RepositoryRoot = Path(__file__).resolve().parents[3]
SourceRevision = '624883b66512daed348c33fcb164b616c9691d46'
ExpectedNativeChanges = {
    'Engine/Lifecycle/DesktopWorkspaceLaunch.cpp',
    'Engine/Workspaces/UV/UVInspectorPanel.cpp',
    'Engine/Workspaces/UV/UVInspectorPanel.h',
    'Engine/Workspaces/UV/UVOutlinerPanel.cpp',
    'Engine/Workspaces/UV/UVOutlinerPanel.h',
}


def ExecuteGit(*Arguments):
    return subprocess.check_output(['git', *Arguments], cwd=RepositoryRoot)


def Main():
    SourcePaths = ExecuteGit('ls-tree', '-r', '--name-only', SourceRevision).decode().splitlines()
    RetainedPaths = [
        SourcePath for SourcePath in SourcePaths
        if SourcePath.startswith(('Engine/', 'EngineContent/', 'Experimental/UVEditor/', 'Experimental/Shared/'))
        or (SourcePath.startswith('Exhibits/') and SourcePath.count('/') == 1 and SourcePath.endswith(('.cpp', '.h')))
        or SourcePath in {
            'Automation/PrepareDependencies.py', 'Automation/Dependencies.json',
            'Automation/PrepareShaderToolchain.py', 'Automation/ApplyImGuiPatches.py',
            'Automation/Patches/PatchH-SmoothOverscroll.patch',
        }
    ]
    Entries = []
    for SourcePath in RetainedPaths:
        SourceBytes = ExecuteGit('show', SourceRevision + ':' + SourcePath)
        CurrentBytes = (RepositoryRoot / SourcePath).read_bytes()
        Entries.append({
            'Path': SourcePath,
            'SourceSha256': hashlib.sha256(SourceBytes).hexdigest(),
            'CurrentSha256': hashlib.sha256(CurrentBytes).hexdigest(),
            'Identical': SourceBytes == CurrentBytes,
        })

    ModifiedPaths = {Entry['Path'] for Entry in Entries if not Entry['Identical']}
    if ModifiedPaths != ExpectedNativeChanges:
        raise RuntimeError('Unexpected continuation differences: ' + repr(ModifiedPaths ^ ExpectedNativeChanges))
    for RejectedPath in ('Engine/Components/PointerWheelExchange.h', 'Engine/Components/PointerWheelExchange.cpp'):
        if (RepositoryRoot / RejectedPath).exists():
            raise RuntimeError('Unnecessary wheel wrapper remains: ' + RejectedPath)

    LaunchPath = 'Engine/Lifecycle/DesktopWorkspaceLaunch.cpp'
    SourceText = ExecuteGit('show', SourceRevision + ':' + LaunchPath).decode().splitlines(keepends=True)
    CurrentText = (RepositoryRoot / LaunchPath).read_text().splitlines(keepends=True)
    InputRepair = ''.join(difflib.unified_diff(SourceText, CurrentText, 'linked/' + LaunchPath, 'current/' + LaunchPath))
    Report = {
        'SourceRepository': 'https://github.com/SultanAladin/Frontier',
        'SourceBranch': 'arena/4c9015d5-frontier',
        'SourceRevision': SourceRevision,
        'SessionBranch': ExecuteGit('branch', '--show-current').decode().strip(),
        'SessionBaseRevision': '96f31ecaef529d383e195013f5f00d163392f71a',
        'ImportedPathCount': len(Entries),
        'IdenticalPathCount': sum(Entry['Identical'] for Entry in Entries),
        'ModifiedNativePaths': sorted(ModifiedPaths),
        'NativeInputRepair': InputRepair,
        'AdditionalBuildFiles': {
            'Automation/UVWorkspace.cmake': 'continued root CMake configuration plus wheel validation registration',
            'Automation/PrepareUVFonts.py': 'continued PrepareFonts.py, renamed to retain older font recovery',
            'Automation/UVFontSources.json': 'byte-identical continued FontSources.json under a separate name',
        },
        'ImportedPaths': Entries,
    }
    OutputPath = RepositoryRoot / 'Exhibits/UVInput/Results/Continuation.json'
    OutputPath.parent.mkdir(parents=True, exist_ok=True)
    OutputPath.write_text(json.dumps(Report, indent=2) + '\n')
    print('{0}/{1} recovered files exactly match the pinned continuation.'.format(
        Report['IdenticalPathCount'], Report['ImportedPathCount']))
    print(InputRepair)
    print('No PointerWheelExchange files; InputExchange and InputExtension remain unchanged.')


if __name__ == '__main__':
    Main()
