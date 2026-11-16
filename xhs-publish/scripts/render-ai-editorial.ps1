param(
  [Parameter(Mandatory=$true)][string]$Spec,
  [Parameter(Mandatory=$true)][string]$Out,
  [string]$NodePath='D:\Infra Tools\nodejs\node.exe'
)
$ErrorActionPreference='Stop'
$env:PUBLISH_SKIP_PROFILE_VERIFY='0'
$env:PUBLISH_SKILL_DATA='D:\AIInfra\agent-publish'
$env:TEMP='D:\AIInfra\render-temp'
$env:TMP=$env:TEMP
$profile=Join-Path $env:TEMP ('editorial-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
$listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop()
if($port -in @(9333,9334,9335)){throw 'Protected port selected'}
$chrome='C:\Program Files\Google\Chrome\Application\chrome.exe'
$code=1
try {
  Start-Process -FilePath $chrome -ArgumentList @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1',"--remote-debugging-port=$port","--user-data-dir=$profile",'about:blank') | Out-Null
  $ready=$false
  for($i=0;$i -lt 40;$i++) {
    try { $null=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1; $ready=$true; break }
    catch { Start-Sleep -Milliseconds 250 }
  }
  if(-not $ready){throw 'Isolated Chrome failed to start'}
  & $NodePath (Join-Path $PSScriptRoot 'render-ai-editorial.mjs') --spec $Spec --out $Out --port $port --profile $profile
  $code=$LASTEXITCODE
} finally {
  & $NodePath (Join-Path $PSScriptRoot 'close-browser.mjs') --profile $profile --port $port
  if($LASTEXITCODE -ne 0){$code=6}
}
exit $code
