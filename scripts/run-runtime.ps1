param([string]$RunName = 'run-2')
$ErrorActionPreference = 'Stop'
if ($RunName -notmatch '^run-\d+$') { throw 'Use a run-N test directory name.' }
$taskWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDirectory = [IO.Path]::GetFullPath((Join-Path $taskWorkspace ('.runtime\' + $RunName)))
if (-not $taskDirectory.StartsWith((Join-Path $taskWorkspace '.runtime\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Test path outside workspace' }
$taskProfile = Join-Path $taskDirectory 'profile'
$taskProcesses = Get-CimInstance Win32_Process -Filter "name = 'zotero.exe'" | Where-Object { $_.CommandLine -match ('-profile\s+"?' + [regex]::Escape($taskProfile) + '"?(?:\s|$)') }
foreach ($taskProcess in $taskProcesses) { Stop-Process -Id $taskProcess.ProcessId }
Set-Location -LiteralPath $taskWorkspace
node scripts/prepare-runtime.mjs $RunName
if ($LASTEXITCODE -ne 0) { throw 'Test preparation failed' }
$taskProcess = Start-Process -FilePath 'D:\Zotero\zotero.exe' -ArgumentList @('-no-remote','-profile',('"' + $taskProfile + '"'),'-purgecaches','-ZoteroDebugText') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskDirectory 'latest.log') -RedirectStandardError (Join-Path $taskDirectory 'latest-error.log')
$taskProcess.Id | Set-Content (Join-Path $taskDirectory 'pid.txt')
$taskProcess | Select-Object Id,HasExited | ConvertTo-Json
