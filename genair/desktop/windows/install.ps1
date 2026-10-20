# מתקין את מערכת ג'נאייר כתוכנה במחשב: חלון משלה, בלי שורת כתובת, עם אייקון בשולחן העבודה ובתפריט התחל.
# מתחת למכסה זה מנוע הדפדפן Edge (או Chrome) שמובנה ב-Windows, במצב אפליקציה.
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'GenairOps'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $src 'app\genair.html') $dest -Force
Copy-Item (Join-Path $src 'app\genair.ico') $dest -Force

function Find-Browser {
  foreach ($exe in 'msedge.exe', 'chrome.exe') {
    foreach ($root in 'HKCU:', 'HKLM:') {
      $key = "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe"
      if (Test-Path $key) {
        $path = (Get-ItemProperty $key).'(default)'
        if ($path -and (Test-Path $path)) { return $path }
      }
    }
  }
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw 'לא נמצא במחשב Microsoft Edge או Google Chrome'
}

$browser = Find-Browser
$page = ([Uri](Join-Path $dest 'genair.html')).AbsoluteUri
# פרופיל נפרד: הנתונים של המערכת לא מתערבבים עם הגלישה הרגילה
$profileDir = Join-Path $dest 'profile'
$launch = "--app=`"$page`" --user-data-dir=`"$profileDir`" --no-first-run --no-default-browser-check --window-size=1440,900"

$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir "ג'נאייר.lnk"))
  $lnk.TargetPath = $browser
  $lnk.Arguments = $launch
  $lnk.IconLocation = (Join-Path $dest 'genair.ico')
  $lnk.WorkingDirectory = $dest
  $lnk.Description = "ג'נאייר - מערכת תפעול"
  $lnk.Save()
}

Write-Host "ההתקנה הסתיימה. האייקון ג'נאייר נמצא בשולחן העבודה ובתפריט התחל."
Start-Process -FilePath $browser -ArgumentList $launch
