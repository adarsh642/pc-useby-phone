# Remote Control MVP

Consent-based Android-to-Windows screen viewing and keyboard-input project.

The repository currently contains:

- a typed Socket.IO/Fastify signaling service with expiring pairing bootstrap;
- Android React Native TypeScript UI and keyboard message validation;
- a WPF/.NET 8 Windows-agent shell with visible consent/disconnect controls;
- protocol, architecture, security, setup, TURN, and test-plan documentation.

The platform-specific WebRTC/capture/native secure-storage integration remains an
explicit next implementation phase; the current foundation deliberately does not
pretend that placeholder UI is a working remote-control channel.

## Current runnable milestone

The signaling server and pairing flow are runnable now. The Windows shell can
create a five-minute pairing ID and secret, and the Android shell can join it.
Pairings are single-use and the Windows UI requires visible local consent.

```powershell
npm install
npm run dev:signaling
```

Then verify `http://localhost:8787/health`. For an Android emulator, the client
uses `http://10.0.2.2:8787`; for a physical phone, replace that address with the
Windows computer's LAN IP.

Run `npm run test:protocol` to validate the input allowlist and pairing schemas.

## Phone and laptop remote-control app

The included desktop agent is an Electron Windows app. The phone uses a mobile
browser at `/app` on the signaling server.

On the Windows laptop:

```powershell
npm install
npm run dev:signaling
npm run start:desktop
```

In the desktop app:

1. Keep **Allow connection requests** enabled.
2. Click **Create pairing code**.
3. Open the phone browser at `http://LAPTOP-LAN-IP:8787/app`.
4. Enter the pairing ID and secret.
5. Approve the phone request on the Windows app.

To build an installer:

```powershell
npm run dist:desktop
```

The installer is written to `apps/desktop-agent/dist`.

Screen sharing, WebRTC negotiation, and keyboard injection are not implemented
yet. Do not treat a successful pairing as a remote-control session.
