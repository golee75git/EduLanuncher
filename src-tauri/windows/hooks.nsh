; EduLauncher NSIS hooks — launch after install files are in place.
; Finish page may also offer Run; single-instance reveals the existing panel.

!macro NSIS_HOOK_POSTINSTALL
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
!macroend
