# Astrocode — one-command network installer for Windows.
#
#   irm https://getsonoma.lol/installcli.ps1 | iex
#
# Downloads the CLI source tarball and installs it via its own installer, which
# writes `astrocode.cmd` / `astrocode.ps1` launcher shims onto a bin directory
# that is (or can be added to) PATH — no admin, no build step. Safe to re-run;
# it upgrades in place.
#
# Overridable via env:
#   $env:ASTROCODE_BUNDLE_URL   tarball of the source tree (has package.json)
#   $env:ASTROCODE_INSTALL_DIR  where the source is unpacked (default ~/.astrocode/cli)
#   $env:NODE                   path to a specific node binary

$ErrorActionPreference = 'Stop'

$AppName = 'Astrocode'
$BundleUrl = if ($env:ASTROCODE_BUNDLE_URL) {
    $env:ASTROCODE_BUNDLE_URL
} else {
    'https://getsonoma.lol/astrocode.tar.gz'
}
$InstallDir = if ($env:ASTROCODE_INSTALL_DIR) {
    $env:ASTROCODE_INSTALL_DIR
} else {
    Join-Path $env:USERPROFILE '.astrocode\cli'
}

function Test-NodeVersion([string]$bin) {
    if (-not $bin) { return $false }
    try {
        $ver = & $bin -p 'process.versions.node' 2>$null
        return $ver -and ([version]$ver -ge [version]'18.17.0')
    } catch {
        return $false
    }
}

Write-Host ''
Write-Host "Installing $AppName"
Write-Host "  platform: Windows (PowerShell $($PSVersionTable.PSVersion))"
Write-Host ''

# ---------------------------------------------------------------------------
# Find Node 18.17+
# ---------------------------------------------------------------------------
$node = $env:NODE
if (-not (Test-NodeVersion $node)) {
    $cand = Get-Command node -ErrorAction SilentlyContinue
    if ($cand -and (Test-NodeVersion $cand.Source)) { $node = $cand.Source }
}
if (-not (Test-NodeVersion $node)) {
    $common = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:APPDATA\nvm\node.exe",
        "$env:USERPROFILE\.volta\bin\node.exe",
        "$env:LOCALAPPDATA\Volta\bin\node.exe"
    )
    foreach ($p in $common) {
        if (Test-NodeVersion $p) { $node = $p; break }
    }
    if (-not (Test-NodeVersion $node)) {
        $fnmNode = Get-ChildItem -Path "$env:LOCALAPPDATA\fnm_multishells" -Filter node.exe -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1 | ForEach-Object { $_.FullName }
        if (Test-NodeVersion $fnmNode) { $node = $fnmNode }
    }
}
if (-not (Test-NodeVersion $node)) {
    Write-Host '  Error: Node 18.17+ was not found.' -ForegroundColor Red
    Write-Host '  Install it from https://nodejs.org (the Windows .msi), or with' -ForegroundColor Yellow
    Write-Host '  nvm-windows / fnm / volta, then run this again.' -ForegroundColor Yellow
    exit 1
}
Write-Host "  Using node $(& $node -v)"

# ---------------------------------------------------------------------------
# Fetch and unpack the CLI source
# ---------------------------------------------------------------------------
$tmp = Join-Path $env:TEMP ('astrocode-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$archive = Join-Path $tmp 'astrocode.tar.gz'

Write-Host "==> Downloading $AppName"
try {
    Invoke-WebRequest -Uri $BundleUrl -OutFile $archive -UseBasicParsing
} catch {
    Write-Host "  Error: could not download $BundleUrl." -ForegroundColor Red
    Write-Host '  Set $env:ASTROCODE_BUNDLE_URL to a reachable tarball and retry.' -ForegroundColor Yellow
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    exit 1
}

Write-Host '==> Extracting'
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if (-not $tar) {
    Write-Host '  Error: tar.exe was not found. Windows 10 (1803+) ships it by default.' -ForegroundColor Red
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    exit 1
}
& $tar.Source -xzf $archive -C $tmp
if ($LASTEXITCODE -ne 0) {
    Write-Host '  Error: the downloaded archive is not a valid tarball.' -ForegroundColor Red
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    exit 1
}

$src = Get-ChildItem -Path $tmp -Recurse -Filter package.json -Depth 2 |
    Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
if (-not $src -or -not (Test-Path (Join-Path $src 'bin\astrocode.js'))) {
    Write-Host '  Error: the archive did not contain an Astrocode checkout.' -ForegroundColor Red
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    exit 1
}

# ---------------------------------------------------------------------------
# Move it into a stable, persistent location — the launcher shims reference
# this path directly, so it must still be here next time `astrocode` runs
# (unlike $tmp, which is deleted below).
# ---------------------------------------------------------------------------
Write-Host "==> Installing into $InstallDir"
New-Item -ItemType Directory -Path (Split-Path $InstallDir -Parent) -Force | Out-Null
if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
Move-Item -Path $src -Destination $InstallDir

# ---------------------------------------------------------------------------
# Hand off to Astrocode's own installer, which writes the `astrocode`/`astro`
# launcher shims onto a directory already on PATH (or explains how to add
# one). Extra args (--prefix, --uninstall, --dry-run, ...) pass straight
# through.
# ---------------------------------------------------------------------------
Write-Host '==> Linking the astrocode command'
& $node (Join-Path $InstallDir 'scripts\install.js') $args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'Astrocode installed.' -ForegroundColor Green
Write-Host ''
if (Get-Command astrocode -ErrorAction SilentlyContinue) {
    Write-Host '  Run: astrocode'
} else {
    Write-Host '  Open a new terminal, then run: astrocode'
    Write-Host '  (The installer may print a directory to add to PATH first.)'
}
Write-Host ''
Write-Host '  That signs you in at getsonoma.lol and drops you into the agent.' -ForegroundColor DarkGray
