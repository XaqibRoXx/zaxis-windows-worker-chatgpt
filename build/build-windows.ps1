$ErrorActionPreference = 'Stop'
Write-Host 'Building Zaxis Worker for Windows x64...'
npm install --save-dev electron@44.4.5 @electron/packager@19.0.1
npx electron-packager . 'Zaxis Worker' --platform=win32 --arch=x64 --electron-version=44.4.5 --out=dist --overwrite --asar
Compress-Archive -Path 'dist/Zaxis Worker-win32-x64/*' -DestinationPath 'dist/Zaxis-Worker-v1.0.1-Windows-x64-Portable.zip' -Force
Write-Host 'Done: dist/Zaxis-Worker-v1.0.1-Windows-x64-Portable.zip'
