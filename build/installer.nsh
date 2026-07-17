!macro customInstall
  DetailPrint "Preparing / Preparando el entorno de desarrollo de Vibe IDE Code."
  DetailPrint "The setup window installs required tools and prepares Android files; it does not launch the emulator."
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --install-environment' $0

  IntCmp $0 0 environment_install_complete
  DetailPrint "Environment setup did not complete. See the setup window for details."
  MessageBox MB_OK|MB_ICONEXCLAMATION "Vibe IDE Code was installed, but environment setup did not complete. Review the setup window details. / Vibe IDE Code se instalo, pero la configuracion del entorno no se completo. Revisa los detalles de la ventana de configuracion."
environment_install_complete:
  DetailPrint "Vibe IDE Code development environment setup completed."
!macroend
