' Creates a desktop shortcut for Polymarket Copy Trading
Set WshShell = WScript.CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get paths
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName)
desktopPath = WshShell.SpecialFolders("Desktop")

' Create shortcut
Set shortcut = WshShell.CreateShortcut(desktopPath & "\Polymarket Copy Trading.lnk")
shortcut.TargetPath = scriptPath & "\run_copy_trading.bat"
shortcut.WorkingDirectory = scriptPath
shortcut.Description = "Start Polymarket Copy Trading Service"
shortcut.IconLocation = "cmd.exe,0"
shortcut.Save

WScript.Echo "Shortcut created on Desktop: Polymarket Copy Trading"
