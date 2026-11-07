# Fetches the native WebView2 loader for the Windows app binary.
#
# Background: nanoui 0.12 loads WebView2Loader.dll dynamically from the folder
# next to the exe. Our root build never calls its dependency install step and
# tools/package.sh ships only the exe, so a Windows GUI without the DLL next
# to it falls back to the native notice window even when the WebView2 Runtime
# IS installed. This script stages the missing piece: the arch-matched
# WebView2Loader.dll plus its license file, copied next to the built exe in
# zig-out/bin, from where package.sh packs them into the release ZIP.
# MS docs: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
# ("The WebView2Loader code needs to be shipped with the app ... by including
# the WebView2Loader.dll that matches the app's architecture.")
#
# Source: official Microsoft.Web.WebView2 NuGet package (pinned stable).
# No system-wide runtime install, no admin, no SDK prerequisites — the
# end user only needs the WebView2 Runtime itself (preinstalled on Win 10/11).
# Temp use is confined to one unique subdir this script creates and removes;
# nothing else under TEMP is touched.

param(
  [string]$Version = "1.0.4314.35",
  [ValidateSet("x64", "x86", "arm64")]
  [string]$Arch = "x64",
  [string]$OutDir = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $binDir = Join-Path (Split-Path -Parent $PSScriptRoot) "zig-out"
  $OutDir = Join-Path $binDir "bin"
}
if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$DllOut = Join-Path $OutDir "WebView2Loader.dll"
$LicenseOut = Join-Path $OutDir "LICENSE.txt"

if ((Test-Path $DllOut) -and (Test-Path $LicenseOut) -and (-not $Force)) {
  Write-Host "WebView2 loader already staged ($Version $Arch), use -Force to refetch."
  exit 0
}

$Url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$Version/microsoft.web.webview2.$Version.nupkg"
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("assetty-webview2-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  # Windows PowerShell 5.1 Expand-Archive requires a .zip extension.
  $nupkg = Join-Path $work "webview2.zip"
  $pkgDir = Join-Path $work "pkg"
  Write-Host "Downloading Microsoft.Web.WebView2 $Version ..."
  Invoke-WebRequest -Uri $Url -OutFile $nupkg -UseBasicParsing
  Expand-Archive -Path $nupkg -DestinationPath $pkgDir

  $dllSrc = Join-Path (Join-Path (Join-Path $pkgDir "build") "native") $Arch
  $dllSrc = Join-Path $dllSrc "WebView2Loader.dll"
  if (-not (Test-Path $dllSrc)) {
    throw "WebView2Loader.dll not found for arch '$Arch' in package $Version"
  }
  $licenseSrc = Join-Path $pkgDir "LICENSE.txt"
  if (-not (Test-Path $licenseSrc)) {
    throw "LICENSE.txt not found in package $Version (refusing to ship a DLL without its license)"
  }
  Copy-Item -Path $dllSrc -Destination $DllOut -Force
  Copy-Item -Path $licenseSrc -Destination $LicenseOut -Force
} finally {
  if (Test-Path $work) { Remove-Item -Path $work -Recurse -Force }
}

if (-not (Test-Path $DllOut)) { throw "stage failed: $DllOut missing" }
if (-not (Test-Path $LicenseOut)) { throw "stage failed: $LicenseOut missing" }
Write-Host "Staged WebView2 $Version $Arch : $DllOut + $LicenseOut"
