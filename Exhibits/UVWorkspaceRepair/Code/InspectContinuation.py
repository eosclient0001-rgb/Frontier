#============================================================================================================================================
#                                                         INSPECTCONTINUATION.PY
#============================================================================================================================================
# 🧩 Audit the broader native UV repair against the pinned continuation without overwriting historical wheel-only evidence.

from pathlib import Path
import hashlib
import json
import subprocess

RepositoryRoot = Path(__file__).resolve().parents[3]
SourceRevision = '624883b66512daed348c33fcb164b616c9691d46'
HistoricalRevision = '3cc230f69c62b9c592f14c4e2ea4ac81983c258d'
ExpectedChanges = {
    'Engine/Components/ContentBrowser/ContentBrowserPanel.cpp',
    'Engine/Components/ControlCentre/ControlCentrePanel.cpp',
    'Engine/Components/Controls/ConfirmationDialogue.cpp',
    'Engine/Components/Panes/ViewportProjectionPane.cpp',
    'Engine/Components/Panes/ViewportProjectionPane.h',
    'Engine/Components/Panes/WorkspaceAppearance.cpp',
    'Engine/Components/Panes/WorkspaceAppearance.h',
    'Engine/Components/PixelSpace.cpp',
    'Engine/Editor/Viewports/ViewportProjection.cpp',
    'Engine/Editor/Viewports/ViewportProjection.h',
    'Engine/GeometricRaster/Rasterization/ImGuiOverlayRasterization.cpp',
    'Engine/GeometricRaster/Rasterization/ImGuiOverlayRasterization.h',
    'Engine/GeometricRaster/Shaders/MatCapEvaluation.slang',
    'Engine/GeometricRaster/Shaders/SurfaceShading.slang',
    'Engine/GeometricRaster/UV/UVWorkspaceRasterizer.cpp',
    'Engine/GeometricRaster/UV/UVWorkspaceRasterizer.h',
    'Engine/Input/InputExchange.h',
    'Engine/Input/InputExtension.cpp',
    'Engine/Input/InputExtension.h',
    'Engine/Lifecycle/DesktopWorkspaceLaunch.cpp',
    'Engine/Lifecycle/EditorLifecycle.cpp',
    'Engine/Lifecycle/EditorLifecycle.h',
    'Engine/Lifecycle/RuntimeLifecycle.cpp',
    'Engine/Lifecycle/RuntimeLifecycle.h',
    'Engine/Windowing/PlatformWindow.h',
    'Engine/Windowing/PlatformWindowDesktop.cpp',
    'Engine/Workspaces/UV/UVInspectorPanel.cpp',
    'Engine/Workspaces/UV/UVInspectorPanel.h',
    'Engine/Workspaces/UV/UVOutlinerPanel.cpp',
    'Engine/Workspaces/UV/UVOutlinerPanel.h',
    'Engine/Workspaces/UV/UVViewportHost.cpp',
    'Engine/Workspaces/UV/UVViewportHost.h',
    'Engine/Workspaces/UV/UVViewportInteractor.cpp',
    'Engine/Workspaces/UV/UVWorkspaceHost.cpp',
    'Engine/Workspaces/UV/UVWorkspaceSession.cpp',
    'Engine/Workspaces/UV/UVWorkspaceSession.h',
    'Exhibits/UVInteractiveAuthoringValidation.cpp',
    'Exhibits/UVRasterPickingGizmoValidation.cpp',
}


def ExecuteGit(*Arguments):
    return subprocess.check_output(['git', *Arguments], cwd=RepositoryRoot)


def Main():
    HistoricalReport = json.loads((RepositoryRoot / 'Exhibits/UVInput/Results/Continuation.json').read_text())
    Entries = []
    for Previous in HistoricalReport['ImportedPaths']:
        SourcePath = Previous['Path']
        SourceBytes = ExecuteGit('show', SourceRevision + ':' + SourcePath)
        CurrentBytes = (RepositoryRoot / SourcePath).read_bytes()
        Entries.append({
            'Path': SourcePath,
            'SourceSha256': hashlib.sha256(SourceBytes).hexdigest(),
            'CurrentSha256': hashlib.sha256(CurrentBytes).hexdigest(),
            'Identical': SourceBytes == CurrentBytes,
        })
    ModifiedPaths = {Entry['Path'] for Entry in Entries if not Entry['Identical']}
    if ModifiedPaths != ExpectedChanges:
        raise RuntimeError('Unexpected continuation changes: ' + repr(ModifiedPaths ^ ExpectedChanges))
    RejectedPaths = ('Engine/Components/PointerWheelExchange.h', 'Engine/Components/PointerWheelExchange.cpp')
    if any((RepositoryRoot / Name).exists() for Name in RejectedPaths):
        raise RuntimeError('The rejected wheel-input wrapper was reintroduced')

    ProtectedPaths = [Entry['Path'] for Entry in Entries if Entry['Path'].startswith((
        'Engine/Codecs/', 'Engine/GeometrySpace/', 'Engine/Mathematics/',
        'EngineContent/Geometry/', 'EngineContent/MatCaps/', 'Experimental/UVEditor/', 'Experimental/Shared/',
    ))]
    if any(Name in ModifiedPaths for Name in ProtectedPaths):
        raise RuntimeError('Geometry, units, codecs, content, or reference sources were unexpectedly changed')
    VehiclePath = 'EngineContent/Geometry/ControlledIntegrator.GeometrySpace'
    if ExecuteGit('show', HistoricalRevision + ':' + VehiclePath) != (RepositoryRoot / VehiclePath).read_bytes():
        raise RuntimeError('The historical vehicle archive was changed')

    OutlinerPath = 'Engine/Workspaces/UV/UVOutlinerPanel.cpp'
    SourceOutliner = ExecuteGit('show', SourceRevision + ':' + OutlinerPath).decode()
    CurrentOutliner = (RepositoryRoot / OutlinerPath).read_text()
    def ExtractFilter(Text):
        Start = Text.index('    // 3. UDIM filter uses the shared DropdownSelector')
        End = Text.index('    const auto LayerSpan =', Start)
        return Text[Start:End]
    if ExtractFilter(SourceOutliner) != ExtractFilter(CurrentOutliner):
        raise RuntimeError('UDIM Filter construction or behavior was changed')
    Report = {
        'Scope': 'Broader native UV rendering, UI, input and resize repair; supersedes the five-change wheel-only scope',
        'SourceRevision': SourceRevision,
        'HistoricalOrientationRevision': HistoricalRevision,
        'SessionBranch': ExecuteGit('branch', '--show-current').decode().strip(),
        'SessionBaseRevision': '96f31ecaef529d383e195013f5f00d163392f71a',
        'HistoricalWheelEvidence': 'Exhibits/UVInput/Results/Continuation.json (retained unchanged)',
        'ImportedPathCount': len(Entries),
        'IdenticalPathCount': sum(Entry['Identical'] for Entry in Entries),
        'ModifiedPaths': sorted(ModifiedPaths),
        'ProtectedPaths': sorted(ProtectedPaths),
        'UDIMFilterConstructionIdentical': True,
        'HistoricalVehicleIdentical': True,
        'RejectedWheelWrapperAbsent': True,
        'ImportedPaths': Entries,
    }
    Output = RepositoryRoot / 'Exhibits/UVWorkspaceRepair/Results/Continuation.json'
    Output.parent.mkdir(parents=True, exist_ok=True)
    Output.write_text(json.dumps(Report, indent=2) + '\n')
    print(f'Continuation: {Report["IdenticalPathCount"]}/{len(Entries)} imported files unchanged; '
          f'{len(ModifiedPaths)} scoped changes; {len(ProtectedPaths)} protected paths unchanged; '
          'UDIM Filter identical; historical vehicle identical; no wheel wrapper.')


if __name__ == '__main__':
    Main()
