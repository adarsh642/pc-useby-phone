# Setup

## Signaling server

1. Install Node.js 20+.
2. Run `npm install` at the repository root.
3. Run `npm run build`.
4. Run `npm run dev:signaling`.
5. Verify `GET http://localhost:8787/health`.
6. Run `npm run test:protocol` to validate keyboard and identity message rules.

## Pairing smoke test

With the signaling server running, open the Windows WPF shell and choose
**Create pairing code**. Copy the pairing ID and secret into the Android app and
choose **Pair computer**. The Windows UI should show that it is waiting for the
phone, and the Android UI should show `awaiting_local_confirmation`.

The Android emulator reaches the host with `http://10.0.2.2:8787`. A physical
phone must use the host computer's LAN IP, and Windows Firewall must allow the
configured port.

## Ready-to-use desktop/phone workflow

Start the signaling server:

```powershell
npm run dev:signaling
```

Start the Windows desktop agent:

```powershell
npm run start:desktop
```

Open the phone browser at `http://YOUR-WINDOWS-LAN-IP:8787/app`.
Create the pairing in the desktop app, enter it on the phone, then approve the
phone request in the desktop app.

For internet use, expose the signaling server on HTTPS and start the desktop
agent with:

```powershell
$env:REMOTE_PC_SERVER_URL="https://remote.example.com"
npm run start:desktop
```

The phone browser, desktop agent, and signaling server must use the same HTTPS
server URL.
