!macro customInit
  ${IfNot} ${isUpdated}
    StrCpy $INSTDIR "D:\AccountBook"
  ${EndIf}
!macroend
