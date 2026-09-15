#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif
#ifndef PackageDir
  #error PackageDir must point to the clean package staging folder
#endif
[Setup]
AppId={{82DAEB9C-1D2F-497B-9253-2165DFF58D31}
AppName=Taproom Signage Server
AppVersion={#AppVersion}
AppPublisher=JFLXCLOUD
AppPublisherURL=https://github.com/JFLXCLOUD/taproom-signage
DefaultDirName={autopf}\Taproom Signage
DefaultGroupName=Taproom Signage
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0
PrivilegesRequired=admin
OutputDir=..\dist
OutputBaseFilename=TaproomSignage-Setup-win-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\TaproomServer.exe
CloseApplications=no
SetupIconFile=..\dist\taproom.ico
[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "TaproomSignage.exe"
Source: "Setup-Server.ps1"; Flags: dontcopy
[Icons]
Name: "{group}\Taproom Signage - Connect your TVs"; Filename: "{app}\TaproomServer.exe"
Name: "{autodesktop}\Taproom Signage"; Filename: "{app}\TaproomServer.exe"
[Run]
Filename: "{app}\TaproomServer.exe"; Description: "Show server addresses and open the control app"; Flags: postinstall nowait skipifsilent runasoriginaluser
[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Setup-Server.ps1"" -Action Uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
[Code]
var
  Settings: TInputQueryWizardPage;
  ExistingPassword: String;
  ConfigPath: String;

procedure InitializeWizard();
var Lines: TArrayOfString; I: Integer;
begin
  ConfigPath := ExpandConstant('{commonappdata}\TaproomSignage\settings\taproom.config');
  Settings := CreateInputQueryPage(wpSelectDir, 'Connect your venue', 'Choose the server port and your control app password',
    'The server starts automatically, even before Windows sign-in. Setup allows TVs on local and routed private networks. Your router must allow traffic between separate Wi-Fi networks or VLANs.');
  Settings.Add('Server port (keep this fixed for your TVs):', False);
  Settings.Add('Control app password (10 or more characters):', True);
  Settings.Values[0] := '8099';
  if LoadStringsFromFile(ConfigPath, Lines) then begin
    for I := 0 to GetArrayLength(Lines) - 1 do begin
      if Pos('port=', Lines[I]) = 1 then Settings.Values[0] := Copy(Lines[I], 6, MaxInt);
      if Pos('password=', Lines[I]) = 1 then ExistingPassword := Copy(Lines[I], 10, MaxInt);
    end;
    Settings.PromptLabels[1].Caption := 'New password (leave blank to keep the existing password):';
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Port: Integer; Password: String;
begin
  Result := True;
  if CurPageID <> Settings.ID then Exit;
  Port := StrToIntDef(Settings.Values[0], 0);
  Password := Trim(Settings.Values[1]);
  if Password = '' then Password := ExistingPassword;
  if (Port < 1024) or (Port > 65535) then begin
    MsgBox('Choose a port between 1024 and 65535.', mbError, MB_OK); Result := False;
  end else if Length(Password) < 10 then begin
    MsgBox('Choose a password of at least 10 characters.', mbError, MB_OK); Result := False;
  end;
end;

function RunSetupScript(Script, Action: String): Boolean;
var Code: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -Action ' + Action + ' -InstallDir "' + ExpandConstant('{app}') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := Result and (Code = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  ExtractTemporaryFile('Setup-Server.ps1');
  if not RunSetupScript(ExpandConstant('{tmp}\Setup-Server.ps1'), 'Prepare') then
    Result := 'Could not prepare the server. Check ProgramData\TaproomSignage\logs\setup-error.txt and run Setup again.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Password, Contents: String;
begin
  if CurStep <> ssPostInstall then Exit;
  Password := Trim(Settings.Values[1]);
  if Password = '' then Password := ExistingPassword;
  Contents := 'port=' + Settings.Values[0] + #13#10 + 'password=' + Password + #13#10 +
    'data_dir=..\data' + #13#10;
  if not SaveStringToFile(ConfigPath, UTF8Encode(#$FEFF + Contents), False) then RaiseException('Could not save server settings.');
  if not RunSetupScript(ExpandConstant('{app}\Setup-Server.ps1'), 'Install') then
    RaiseException('Server setup failed. See ProgramData\TaproomSignage\logs\setup-error.txt. If the port is busy, run Setup again with another port.');
end;
