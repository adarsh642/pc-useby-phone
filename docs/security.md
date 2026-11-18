# Security model

This MVP is consent-based and limited to screen viewing and keyboard input. It has
no stealth, persistence, credential capture, keylogging, clipboard, shell, file,
audio, or camera features. The Windows agent must reject injection for unpaired,
disabled, inactive, or non-consented sessions and cannot operate on UAC/secure
desktop surfaces.

Pairing secrets are high entropy and short-lived; device private keys belong in
Windows DPAPI/Credential Manager and Android Keystore in the production wiring.
Signaling must use TLS, short-lived authenticated tokens, rate limits, redacted
structured logs, and durable storage for only device/pairing metadata.
