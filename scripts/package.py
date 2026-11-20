from pathlib import Path
import zipfile,io,json,hashlib,base64,textwrap
root=Path(__file__).resolve().parents[1];release=root/'build/Release'
(root/'dist').mkdir(exist_ok=True)
files={n:(release/n).read_bytes() for n in ['WydLauncher.exe','WydNative.dll']}
files['README.txt']=(root/'packaging/README.txt').read_bytes()
files['LICENSE.txt']=(root/'LICENSE').read_bytes()
files['LICENSE-QuickJS.txt']=(root/'third_party/LICENSE-QuickJS.txt').read_bytes()
files['LICENSE-MinHook.txt']=(root/'third_party/LICENSE-MinHook.txt').read_bytes()
manifest=json.dumps({'files':[{'path':n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in sorted(files.items())]},indent=2).encode()
files['manifest.json']=manifest
stream=io.BytesIO()
with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for n,b in sorted(files.items()):
  info=zipfile.ZipInfo(n,(2026,11,20,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,b)
payload=stream.getvalue();digest=hashlib.sha256(payload).hexdigest();ps=(root/'packaging/bootstrap.ps1').read_text(encoding='utf-8').replace('__ZIP_SHA256__',digest).replace('__MANIFEST_SHA256__',hashlib.sha256(manifest).hexdigest())
header='''@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "WYD_BUNDLE=%~f0"
set "WYD_MODE=%~1"
set "WYD_PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
if exist "%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe" set "WYD_PS=%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe"
"%WYD_PS%" -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop'; try { $bundleText=[IO.File]::ReadAllText($env:WYD_BUNDLE,[Text.Encoding]::UTF8); $begin=[regex]::Match($bundleText,'(?m)^:__WYD_POWERSHELL__\\r?$'); $end=[regex]::Match($bundleText,'(?m)^:__WYD_PAYLOAD__\\r?$'); if(!$begin.Success -or !$end.Success){throw 'Incomplete BAT file'}; & ([scriptblock]::Create($bundleText.Substring($begin.Index+$begin.Length,$end.Index-$begin.Index-$begin.Length))) } catch { Write-Host $_.Exception.Message; exit 1 }"
set "WYD_EXIT=%ERRORLEVEL%"
if not "%WYD_EXIT%"=="0" if not "%WYD_MODE%"=="--check" pause
exit /b %WYD_EXIT%
:__WYD_POWERSHELL__
'''
body=header+ps+'\n:__WYD_PAYLOAD__\n'+'\n'.join(textwrap.wrap(base64.b64encode(payload).decode(),120))+'\n'
out=root/'dist/WaterYouModding.bat';out.write_bytes(body.replace('\r\n','\n').replace('\n','\r\n').encode('utf-8'))
(root/'build/payload.zip').write_bytes(payload)
(root/'build/package-build.json').write_text(json.dumps({'bytes':out.stat().st_size,'payloadBytes':len(payload),'payloadSha256':digest,'manifest':json.loads(manifest)},indent=2),encoding='utf-8')
print(json.dumps({'bat':str(out),'bytes':out.stat().st_size,'payloadBytes':len(payload),'sha256':digest}))

(root/'dist/SHA256SUMS.txt').write_text(hashlib.sha256(out.read_bytes()).hexdigest()+'  '+out.name+'\n',encoding='ascii')
