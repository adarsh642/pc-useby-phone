# Protocol

Pairing uses `POST /pairing/create` and `POST /pairing/join`. The returned secret is
one-time, expires after five minutes, and must be replaced with device public-key
authentication after local confirmation.

Socket events are `auth.device`, `presence.update`, `session.request`,
`session.approve`, `session.reject`, `webrtc.offer`, `webrtc.answer`,
`webrtc.iceCandidate`, `session.end`, `desktop.frame`, `desktop.control`,
`desktop.controlAck`, `desktop.rtt`, and `desktop.congestion`. Every relay includes
`sourceDeviceId` and targets a specific authenticated device.

`desktop.frame` is a binary event: `(metadata: FrameMetadata, buffer: ArrayBuffer)`
where `buffer` is a JPEG-encoded screen capture. `FrameMetadata` includes
`targetDeviceId`, `quality`, `width`, `height`, `ts`, and `seq`.

`desktop.rtt` and `desktop.congestion` carry round-trip-time and receiver
congestion signals used for adaptive quality and backpressure.

Keyboard DataChannel messages:

```ts
type KeyboardMessage =
  | { type: "text"; text: string }
  | { type: "key"; key: "Enter"|"Escape"|"Tab"|"Backspace"|"ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight"; modifiers?: ("Ctrl"|"Alt"|"Shift")[] };
```

Text is bounded to 2048 characters per message. Raw key messages use an allowlist.
