"""Compile the shared SolidArc command-stream export for Emscripten or local native development."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import subprocess
import os
import sys

Root = Path(__file__).resolve().parents[3]
Source = Root / 'Editor/AuthoringTools/Modelling/SolidArc'
Destination = Path(__file__).resolve().parents[1] / 'Runtime'
Native = '--native' in sys.argv
Scratch = Root / '_AgentScratch/build' / ('SolidArcNative' if Native else 'SolidArcWeb')
Scratch.mkdir(parents=True, exist_ok=True)
Destination.mkdir(parents=True, exist_ok=True)
Compiler = os.environ.get('CXX', 'g++') if Native else os.environ.get('EMXX', 'em++')
Files = []
for Folder in ['Kernel', 'Document', 'Interaction']:
    Files += sorted((Source / Folder).glob('*.cpp'))
Files += [Source / 'Presentation' / Name for Name in ['ScenePresentation.cpp', 'SoftwareRaster.cpp']]
Files += [Source / 'Console' / Name for Name in ['CommandCodec.cpp', 'ConsoleHost.cpp', 'ConsoleInteraction.cpp', 'ConsoleSelection.cpp']]
Files += [Path(__file__).with_name('GeometryExchange.cpp')]
Options = ['-std=c++20', '-O2', '-fexceptions', '-I' + str(Source), '-DSOLIDARC_PROOF_FOLDER="/"']
if Native:
    Header = Root / 'ExternalPackages/json/include/nlohmann/json.hpp'
    if not Header.exists():
        import base64
        Result = json.loads(subprocess.check_output(['gh', 'api', 'repos/nlohmann/json/contents/single_include/nlohmann/json.hpp?ref=55f93686c01528224f448c19128836e7df245f72']))
        Header.parent.mkdir(parents=True, exist_ok=True)
        Header.write_bytes(base64.b64decode(Result['content']))
    ExpectedHeader = 'aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63'
    if hashlib.sha256(Header.read_bytes()).hexdigest() != ExpectedHeader:
        raise RuntimeError('nlohmann/json header does not match pinned v3.12.0; restore the declared upstream dependency')
    Options += ['-I' + str(Header.parents[1])]
    Files += [Path(__file__).with_name('GeometryHost.cpp')]

def Compile(Path):
    Target = Scratch / (Path.stem + '.o')
    Dependency = Target.with_suffix('.d')
    Command = [Compiler, *Options, '-MMD', '-MF', str(Dependency), '-c', str(Path), '-o', str(Target)]
    Signature = Target.with_suffix('.command')
    Inputs = [Path]
    if Dependency.exists():
        Inputs += [type(Path)(Name) for Name in Dependency.read_text().replace('\\\n', ' ').split(':', 1)[1].split()]
    if (not Target.exists() or not Signature.exists() or Signature.read_text() != json.dumps(Command)
            or any(not Item.exists() or Item.stat().st_mtime > Target.stat().st_mtime for Item in Inputs)):
        Result = subprocess.run(Command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if Result.returncode:
            raise RuntimeError(Result.stdout)
        Signature.write_text(json.dumps(Command))
    return str(Target)

with ThreadPoolExecutor(max_workers=3) as Pool:
    Compiled = list(Pool.map(Compile, Files))
if Native:
    Target = Scratch / 'GeometryHost'
    subprocess.run([Compiler, *Options, *Compiled, '-o', str(Target)], check=True)
    print(Target)
else:
    subprocess.run([Compiler, *Options, *Compiled, '-o', str(Destination / 'GeometryModule.js'),
        '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
        '-sSTACK_SIZE=4194304', '-sMAXIMUM_MEMORY=2147483648', '-sFORCE_FILESYSTEM=1',
        '-sEXPORTED_RUNTIME_METHODS=ccall,FS,UTF8ToString,HEAPU8', '-sDISABLE_EXCEPTION_CATCHING=0'], check=True)
    print('Compiled native vertex-command export for WebAssembly:', Destination)
(Scratch / 'Provenance.json').write_text(json.dumps({
    'compiler': subprocess.check_output([Compiler, '--version'], text=True).splitlines()[0],
    'sources': {str(Item.relative_to(Root)): hashlib.sha256(Item.read_bytes()).hexdigest() for Item in Files},
    'shaders': {str(Item.relative_to(Root)): hashlib.sha256(Item.read_bytes()).hexdigest()
                for Item in sorted((Source / 'Presentation/Shaders').glob('*.slang'))},
    'options': Options,
    'jsonHeader': hashlib.sha256(Header.read_bytes()).hexdigest() if Native else None,
}, indent=2) + '\n')
