# Architecture

The Android client and Windows agent authenticate to the signaling service, which
relays only pairing, session, SDP, ICE, presence, and teardown messages. Screen
video and keyboard events travel over WebRTC; TURN is used when direct LAN/NAT
connectivity fails.

```mermaid
flowchart LR
  A[Android React Native] <-->|Socket.IO signaling| S[Node signaling]
  W[Windows WPF agent] <-->|Socket.IO signaling| S
  A <-->|WebRTC video + ordered DataChannel| W
  A -. ICE .-> T[coturn STUN/TURN]
  W -. ICE .-> T
  L[LAN discovery optional] -. bootstrap only .-> A
```

The agent visibly exposes pairing, consent, active-session state, and immediate
disconnect. No input is injected unless the device is paired, the agent is enabled,
the session is active, and local consent is present.
