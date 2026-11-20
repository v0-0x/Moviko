; Included in the Windows installer by electron-builder
; (desktop/electron-builder.yml, nsis.include).
!include LogicLib.nsh
!include x64.nsh

; Moviko installs for the current user only: no admin rights, and no
; "Anyone who uses this computer / Only for me" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Moviko was called KumoBox before 2.0.9: an update over KumoBox installs in a
; Moviko folder next to KumoBox's (...\Programs\Moviko), and KumoBox's own
; uninstaller then removes the KumoBox one, as with any update.
!macro customInit
  StrCpy $0 $INSTDIR "" -8
  ${if} $0 == "\KumoBox"
    StrCpy $INSTDIR $INSTDIR -8
    StrCpy $INSTDIR "$INSTDIR\Moviko"
  ${endIf}
!macroend

; The programs Moviko uses (ffmpeg, yt-dlp, mpv) aren't installed here: Moviko
; downloads them itself, from the notice on its Home page or Settings > App &
; data (server/internal/winsetup).
!macro customInstall
  ; Explorer keeps showing the icons it cached for Moviko's shortcuts: tell it
  ; icons changed, so a new logo shows right after an update.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Started with Windows (desktop/main.js setStartAtLogin): the entry names
  ; the program, which an update over KumoBox moved and renamed.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.kumobox.desktop"
  ${if} $0 != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.kumobox.desktop" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --background'
  ${endIf}
  ; Let the other devices reach Moviko (library sharing, the TV app): a
  ; Windows Firewall rule for the server, on private networks, for its port
  ; and the port it announces itself on. Without it the firewall asks the
  ; first time sharing is turned on, and drops the announcements of the
  ; others (the server then looks offline between its answers). Adding a
  ; rule needs an administrator's yes, once; an update keeps the rule.
  ${ifNot} ${Silent}
  ${andIfNot} ${isUpdated}
    ${if} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION "Let the other devices on your home network reach Moviko?$\r$\n$\r$\nThis adds a Windows Firewall rule for Moviko's server on private networks (for library sharing, the media server and the TV app). Windows asks for an administrator's permission once. Without it, Windows asks when sharing is first turned on, and the other devices may show as offline now and then.$\r$\n$\r$\nYou can add it later with: netsh advfirewall firewall add rule name=Moviko dir=in action=allow program=moviko.exe" /SD IDYES IDYES`
      ExecShell "runas" "$SYSDIR\cmd.exe" '/c netsh advfirewall firewall delete rule name="Moviko" >nul 2>&1 & netsh advfirewall firewall add rule name="Moviko" dir=in action=allow program="$INSTDIR\resources\moviko.exe" protocol=TCP localport=43311 profile=private & netsh advfirewall firewall add rule name="Moviko" dir=in action=allow program="$INSTDIR\resources\moviko.exe" protocol=UDP localport=43312 profile=private' SW_HIDE
    ${endIf}
  ${endIf}
!macroend

; Uninstalled (not updated): Moviko's "start with Windows" entry goes too
; (desktop/main.js setStartAtLogin), or Startup apps keeps a dead "Moviko".
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.kumobox.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "app.kumobox.desktop"
    ; The firewall rule too (an administrator's yes; declining keeps a rule
    ; for a program that's gone, which does nothing).
    ${ifNot} ${Silent}
      ExecShell "runas" "$SYSDIR\cmd.exe" '/c netsh advfirewall firewall delete rule name="Moviko"' SW_HIDE
    ${endIf}
  ${endIf}
!macroend
