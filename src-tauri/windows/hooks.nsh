; EduLauncher NSIS hooks.
; The finish page starts the app when 마침 is clicked. Do not start it here.

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$APPDATA\Microsoft\Windows\SendTo\교육업무 런처.lnk"
!macroend
