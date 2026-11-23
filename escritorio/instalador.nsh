!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Halcon Pruebas"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Halcon Pruebas" dir=in action=allow protocol=TCP localport=47800 profile=any remoteip=localsubnet'
!macroend
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Halcon Pruebas"'
!macroend
