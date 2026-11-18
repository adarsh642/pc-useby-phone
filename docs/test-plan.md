# Test plan

- Pairing expires and rejects reused/invalid secrets.
- Pairing confirmation is required on Windows before trust.
- Revoked devices cannot authenticate or request sessions.
- Session requests are rejected when local consent is disabled.
- DataChannel messages reject unknown keys and oversized text.
- WebRTC uses direct LAN connectivity where possible and TURN fallback otherwise.
- UAC/secure desktop input is never injected.
- Disconnect tears down the peer connection and invalidates the session token.
