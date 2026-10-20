# מסיר את מערכת ג'נאייר מהמחשב: האייקונים, הקבצים והנתונים שנשמרו בה
$ErrorActionPreference = 'SilentlyContinue'
$dest = Join-Path $env:LOCALAPPDATA 'GenairOps'
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  Remove-Item (Join-Path $dir "ג'נאייר.lnk") -Force
}
Remove-Item $dest -Recurse -Force
Write-Host 'המערכת הוסרה מהמחשב.'
