# Building the Windows installer

On a clean build machine with Python 3.12, Playwright, and Inno Setup installed:

```powershell
cd desktop-worker
.\build-worker-exe.ps1
iscc .\installer\GrewalWorker.iss
```

The result is `dist\GrewalWorkerSetup.exe`. The installer contains the worker
runtime and Chromium dependencies, but never includes `.env`, TAFE credentials,
or the desktop-worker token. After installation, copy `.env.example` to `.env`
and fill the local configuration on the assigned PC.
