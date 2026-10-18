# Keeps the AliSwift extension folder current. It reads the newest GitHub release and, when that is newer than the folder's
# manifest.json, downloads the release zip, checks it is the same extension (same manifest key) and copies it over, with
# manifest.json last. The extension notices the new manifest.json within a minute and reloads itself.
#
#   update.ps1                      update now
#   update.ps1 -Schedule            update now, then check at every sign-in and every hour
#   update.ps1 -Unschedule          stop checking
#   update.ps1 -Extension <folder>  the folder Chrome loads (default: "extension" next to this script)
#
# Only files are added or replaced in that folder; none are deleted. Needs nothing but Windows PowerShell.
param(
  [string]$Extension = (Join-Path $PSScriptRoot 'extension'),
  [switch]$Schedule,
  [switch]$Unschedule
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo = 'envyxyz/aliswift'
$Task = 'AliSwift update'
$Extension = $Extension.TrimEnd('\')

if ($Unschedule) {
  Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output 'AliSwift will no longer check for updates.'
  exit 0
}

function Update-Extension {
  $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'aliswift-updater' }
  $latest = [version]($release.tag_name -replace '^v', '')
  $manifestPath = Join-Path $Extension 'manifest.json'
  $local = $null
  if (Test-Path $manifestPath) {
    $local = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ([version]$local.version -ge $latest) { return "AliSwift $($local.version) is up to date." }
  }
  $asset = $release.assets | Where-Object { $_.name -like 'aliswift-v*.zip' } | Select-Object -First 1
  if (-not $asset) { throw "Release $($release.tag_name) has no zip yet. Try again later." }

  $work = Join-Path ([IO.Path]::GetTempPath()) "aliswift-update-$latest"
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory $work | Out-Null
  try {
    $zip = Join-Path $work 'release.zip'
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive $zip (Join-Path $work 'files')
    $src = (Resolve-Path (Join-Path $work 'files\aliswift')).Path
    $new = Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
    if ([version]$new.version -ne $latest) { throw "The zip holds $($new.version), not $latest. Nothing was changed." }
    # Same key, same extension ID: a folder that is not AliSwift is never written over.
    if ($local -and $local.key -ne $new.key) { throw "$Extension is not the AliSwift folder (its manifest key differs). Nothing was changed." }

    New-Item -ItemType Directory -Force $Extension | Out-Null
    Get-ChildItem $src -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($src.Length + 1)
      if ($relative -eq 'manifest.json') { return } # last, below: the extension reloads when it changes
      $target = Join-Path $Extension $relative
      New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
      Copy-Item $_.FullName $target -Force
    }
    Copy-Item (Join-Path $src 'manifest.json') $manifestPath -Force
    # This script too, so a fix to it reaches everyone (PowerShell has read it whole by now).
    $self = $release.assets | Where-Object { $_.name -eq 'update.ps1' } | Select-Object -First 1
    if ($self -and $PSCommandPath) { try { Invoke-WebRequest $self.browser_download_url -OutFile $PSCommandPath -UseBasicParsing } catch { } }
    return "AliSwift updated to $latest. Chrome reloads it within a minute."
  } finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Output (Update-Extension)

if ($Schedule) {
  $run = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Extension `"$Extension`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $run
  $triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
    (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1))
  )
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName $Task -Action $action -Trigger $triggers -Settings $settings -Force | Out-Null
  Write-Output "AliSwift will check for updates at every sign-in and every hour."
}
