@echo off
REM Plant!p Dev Server Launcher
REM Usage: start.bat [port]

set PORT=%1
if "%PORT%"=="" set PORT=8000

echo.
echo  ====================================
echo   Plant!p Server Starting...
echo   http://localhost:%PORT%
echo  ====================================
echo.

python -m uvicorn main:app --host 0.0.0.0 --port %PORT% --reload
