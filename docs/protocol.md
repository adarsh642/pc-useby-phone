# Protocol

Pairing uses `POST /pairing/create` and `POST /pairing/join`. The returned secret is
one-time, expires after five minutes, and must be replaced with device public-key
authentication after local confirmation.

Socket events are `auth.device`, `presence.update`, `session.request`,
`session.approve`, `session.reject`, `webrtc.offer`, `webrtc.answer`,
`webrtc.iceCandidate`, and `session.end`. Every relay includes `sourceDeviceId` and
targets a specific authenticated device.

Keyboard DataChannel messages:

```ts
type KeyboardMessage =
  | { type: "text"; text: string }
  | { type: "key"; key: "Enter"|"Escape"|"Tab"|"Backspace"|"ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight"; modifiers?: ("Ctrl"|"Alt"|"Shift")[] };
```

Text is bounded to 2048 characters per message. Raw key messages use an allowlist.
