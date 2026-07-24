<#
.SYNOPSIS
  Astrocode installer for Windows (PowerShell 5.1+ and PowerShell 7+).

.DESCRIPTION
  Locates Node and hands over to scripts/install.js, which does the real work.
  Any parameters are passed straight through.

.EXAMPLE
  .\install.ps1
  .\install.ps1 --uninstall
  .\install.ps1 --prefix C:\tools\bin

.NOTES
  If PowerShell refuses to run this file, it is the execution policy, not the
  script. Either of these works:
    powershell -ExecutionPolicy Bypass -File .\install.ps1
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#>

[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Join-Path $root 'scripts\install.js'

if (-not (Test-Path -LiteralPath $installer)) {
  Write-Host "astrocode: could not find $installer" -ForegroundColor Red
  Write-Host "Run this from inside a complete Astrocode checkout."
  exit 1
}

function Find-Node {
  if ($env:NODE -and (Test-Path -LiteralPath $env:NODE)) { return $env:NODE }

  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  # Places an installer may have used that this session's PATH might not have.
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "$env:APPDATA\nvm\node.exe",
    "$env:LOCALAPPDATA\fnm_multishells\node.exe",
    "$env:USERPROFILE\scoop\shims\node.exe"
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

$node = Find-Node
if (-not $node) {
  Write-Host "astrocode: could not find Node." -ForegroundColor Red
  Write-Host ""
  Write-Host "Astrocode needs Node 18.17 or newer. Install it from https://nodejs.org"
  Write-Host "(or: winget install OpenJS.NodeJS.LTS), then run this script again."
  Write-Host ""
  Write-Host "If Node is installed somewhere unusual, point at it directly:"
  Write-Host '  $env:NODE = "C:\path\to\node.exe"; .\install.ps1'
  exit 1
}

& $node $installer @Args
exit $LASTEXITCODE
