# Native CPU reference: C++17/CMake, Node and Python required. No Actions run or GPU substitution.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
$Build = Join-Path (Get-Location) '_ClaudeScratch/build/vehicle-reference-windows'
node Exhibits/VehicleReference/Code/Materials.mjs
if ($LASTEXITCODE) { throw 'Authored material export failed' }
cmake -S Exhibits/VehicleReference -B $Build
if ($LASTEXITCODE) { throw 'CMake configuration failed' }
cmake --build $Build --config Release --parallel 2 --target VehicleCapture TriangleVisibilityValidation CompleteRendererValidation
if ($LASTEXITCODE) { throw 'C++ compilation failed' }
& "$Build/Release/TriangleVisibilityValidation.exe" | Tee-Object Exhibits/VehicleReference/VisibilityResults.txt
if ($LASTEXITCODE) { throw 'Triangle visibility validation failed' }
& "$Build/complete/Release/CompleteRendererValidation.exe" | Tee-Object Exhibits/VehicleReference/RendererResults.txt
if ($LASTEXITCODE) { throw 'Reference renderer regression failed' }
& "$Build/Release/VehicleCapture.exe" '_ClaudeScratch/vehicle-reference' | Tee-Object Exhibits/VehicleReference/CaptureResults.txt
if ($LASTEXITCODE) { throw 'Native vehicle capture failed' }
python Exhibits/VehicleReference/Code/Images.py
if ($LASTEXITCODE) { throw 'PNG conversion failed' }
python Exhibits/VehicleReference/Code/Evidence.py
if ($LASTEXITCODE) { throw 'Evidence hashing failed' }
