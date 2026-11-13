@echo off
rem Launch the adjacent Windows application with its bundled content as the working directory.
pushd "%~dp0"
if errorlevel 1 exit /b 1
"%~dpn0.exe" %*
set "FrontierExit=%ERRORLEVEL%"
popd
exit /b %FrontierExit%
