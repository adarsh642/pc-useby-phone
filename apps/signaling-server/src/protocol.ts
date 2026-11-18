import { z } from "zod";

export const deviceId = z.string().min(16).max(128);
export const pairingId = z.string().trim().regex(/^[A-Z2-9]{6}$/);

export const pairingCreateSchema = z.object({
  deviceId,
  deviceName: z.string().trim().min(1).max(80)
});

export const pairingJoinSchema = z.object({
  pairingId,
  secret: z.string().trim().regex(/^[A-Za-z0-9_-]{10,16}$/),
  deviceId,
  deviceName: z.string().trim().min(1).max(80)
});

export const deviceAuthSchema = z.object({
  deviceId,
  deviceName: z.string().trim().min(1).max(80),
  publicKey: z.string().min(32).max(4096)
});

export type DeviceAuth = z.infer<typeof deviceAuthSchema>;

export const relayEvents = [
  "session.request",
  "session.approve",
  "session.reject",
  "webrtc.offer",
  "webrtc.answer",
  "webrtc.iceCandidate",
  "session.end",
  "presence.update",
  "desktop.frame",
  "desktop.control",
  "desktop.controlAck",
  "file.available"
] as const;
