# Remote Control MVP

Consent-based Android-to-Windows screen viewing and keyboard-input project.

The repository currently contains:

- a typed Socket.IO/Fastify signaling service with expiring pairing bootstrap;
- Android React Native TypeScript UI and keyboard message validation;
- a WPF/.NET 8 Windows-agent shell with visible consent/disconnect controls;
- protocol, architecture, security, setup, TURN, and test-plan documentation.

The current milestone adds a realtime screen-viewing and input channel over the
signaling relay: binary JPEG frames, adaptive capture framerate, requestAnimationFrame
rendering, coalesced pointer input, RTT-based congestion control, and backpressure-aware
frame dropping. WebRTC direct-connect remains a future phase for lower-latency LAN/
NAT traversal.

## Current runnable milestone

The signaling server, pairing flow, and realtime screen-viewing/input channel are
runnable now. The Windows desktop agent captures the screen and sends binary JPEG
frames to the phone browser; the phone sends pointer and keyboard input back over
the signaling relay with sub-frame coalescing and RTT-based congestion control.
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

Keyboard injection and screen viewing are implemented over the signaling relay.
Direct WebRTC peer-to-peer video/DataChannel is not implemented yet. Do not treat
a successful pairing as a fully optimized remote-control session until WebRTC is
added.
