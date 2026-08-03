[Setup]
AppName=Grewal Office Worker
AppVersion=1.0.0
DefaultDirName={autopf}\GrewalOfficeWorker
DefaultGroupName=Grewal Office Worker
OutputDir=..\dist
OutputBaseFilename=GrewalWorkerSetup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin

[Files]
Source: "..\dist\GrewalOfficeWorker\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "..\..\desktop-worker\.env.example"; DestDir: "{app}"; DestName: ".env.example"; Flags: ignoreversion

[Dirs]
Name: "{app}\downloads"
Name: "{app}\screenshots"

[Icons]
Name: "{group}\Grewal Office Worker"; Filename: "{app}\GrewalOfficeWorker.exe"
Name: "{commondesktop}\Grewal Office Worker"; Filename: "{app}\GrewalOfficeWorker.exe"

[Run]
Filename: "{app}\GrewalOfficeWorker.exe"; Description: "Start Grewal Office Worker"; Flags: postinstall nowait skipifsilent
