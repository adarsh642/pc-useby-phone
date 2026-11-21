import Fastify from "fastify";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  deviceAuthSchema,
  pairingCreateSchema,
  pairingJoinSchema,
  relayEvents,
  type FrameMetadata
} from "./protocol.js";

const app = Fastify({ logger: { redact: ["req.headers.authorization", "secret"] }, bodyLimit: 26 * 1024 * 1024 });
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, payload, done) => {
  done(null, payload);
});
const io = new Server(app.server, {
  cors: { origin: false },
  maxHttpBufferSize: 64 * 1024 * 1024,
  pingInterval: 10_000,
  pingTimeout: 5_000
});
const port = Number(process.env.PORT ?? 8787);
const pairingTtlMs = 5 * 60_000;
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const transfers = new Map<string, { name: string; data: Buffer; expiresAt: number }>();

type Pairing = {
  secretDigest: string;
  ownerDeviceId: string;
  ownerDeviceName: string;
  expiresAt: number;
  joinedDeviceId?: string;
};

const pairings = new Map<string, Pairing>();
const activeSessions = new Map<string, { pairingId: string; ownerDeviceId: string; phoneDeviceId: string }>();
type DeviceInfo = {
  socketId: string;
  name: string;
  publicKey: string;
  lastFrameTs: number;
  frameSeq: number;
  rttMs: number;
  congested: boolean;
};
const devices = new Map<string, DeviceInfo>();

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function secretsMatch(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(digest(provided));
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

function pairedSessionFor(ownerDeviceId: string, phoneDeviceId: string): boolean {
  for (const session of activeSessions.values()) {
    if (session.ownerDeviceId === ownerDeviceId && session.phoneDeviceId === phoneDeviceId) return true;
  }
  return false;
}

app.get("/health", async () => ({ status: "ok", service: "signaling-server" }));

app.get("/app", async (_request, reply) => {
  reply.type("text/html");
  return readFile(join(publicDir, "index.html"));
});

app.get("/app.js", async (_request, reply) => {
  reply.type("application/javascript");
  return readFile(join(publicDir, "app.js"));
});

app.get("/app.css", async (_request, reply) => {
  reply.type("text/css");
  return readFile(join(publicDir, "app.css"));
});

app.post("/pairing/create", async (request, reply) => {
  const parsed = pairingCreateSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
  let id: string;
  do {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    id = Array.from({ length: 5 }, () => alphabet[randomBytes(1)[0] % alphabet.length]).join("");
  } while ([...pairings.keys()].includes(id));
  const secret = randomBytes(6).toString("base64url");
  const expiresAt = Date.now() + pairingTtlMs;
  pairings.set(id, {
    secretDigest: digest(secret),
    ownerDeviceId: parsed.data.deviceId,
    ownerDeviceName: parsed.data.deviceName,
    expiresAt
  });
  reply.header("Cache-Control", "no-store");
  return { pairingId: id, secret, expiresAt };
});

app.post("/pairing/join", async (request, reply) => {
  const parsed = pairingJoinSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
  const pairing = pairings.get(parsed.data.pairingId);
  if (!pairing || pairing.expiresAt < Date.now() || !secretsMatch(pairing.secretDigest, parsed.data.secret)) {
    return reply.code(401).send({ error: "pairing_expired_or_invalid" });
  }
  if (pairing.joinedDeviceId) {
    return reply.code(409).send({ error: "pairing_already_used" });
  }
  pairing.joinedDeviceId = parsed.data.deviceId;
  return {
    status: "awaiting_local_confirmation",
    ownerDeviceId: pairing.ownerDeviceId,
    ownerDeviceName: pairing.ownerDeviceName
  };
});

app.post("/transfer/upload", async (request, reply) => {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.startsWith("application/octet-stream")) {
    return reply.code(400).send({ error: "invalid_content_type" });
  }
  const name = String(request.headers["x-file-name"] ?? "transfer.bin").slice(0, 255);
  const data = Buffer.isBuffer(request.body) ? request.body : Buffer.from(String(request.body ?? ""));
  if (data.length > 25 * 1024 * 1024) {
    return reply.code(413).send({ error: "transfer_too_large" });
  }
  const id = randomUUID();
  transfers.set(id, { name, data, expiresAt: Date.now() + 10 * 60_000 });
  reply.header("Cache-Control", "no-store");
  return { transferId: id, name, size: data.length };
});

app.get("/transfer/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const transfer = transfers.get(id);
  if (!transfer || transfer.expiresAt < Date.now()) {
    transfers.delete(id);
    return reply.code(404).send({ error: "transfer_not_found" });
  }
  reply.header("Content-Disposition", `attachment; filename="${transfer.name.replace(/["\r\n]/g, "_")}"`);
  reply.type("application/octet-stream");
  reply.header("Cache-Control", "no-store");
  transfers.delete(id);
  return reply.send(transfer.data);
});

io.on("connection", (socket) => {
  socket.on("auth.device", (payload: unknown, acknowledge?: (result: object) => void) => {
    const parsed = deviceAuthSchema.safeParse(payload);
    if (!parsed.success) return acknowledge?.({ ok: false, error: "invalid_device_auth" });
    devices.set(parsed.data.deviceId, {
      socketId: socket.id,
      name: parsed.data.deviceName,
      publicKey: parsed.data.publicKey,
      lastFrameTs: 0,
      frameSeq: 0,
      rttMs: 0,
      congested: false
    });
    socket.data.deviceId = parsed.data.deviceId;
    acknowledge?.({ ok: true });
  });

  // Binary frame relay: desktop.frame(metadata, buffer)
  socket.on("desktop.frame", (metadata: FrameMetadata, buffer: unknown, acknowledge?: () => void) => {
    const senderId = socket.data.deviceId as string | undefined;
    const targetId = metadata?.targetDeviceId;
    if (!targetId) {
      acknowledge?.();
      return;
    }
    const target = devices.get(targetId);
    if (!target) {
      socket.emit("error", { error: "target_offline" });
      acknowledge?.();
      return;
    }
    const sender = senderId ? devices.get(senderId) : undefined;
    if (!pairedSessionFor(senderId ?? "", targetId)) {
      socket.emit("error", { error: "session_not_approved" });
      acknowledge?.();
      return;
    }
    if (sender && target.congested) {
      // Drop frame if receiver is congested to avoid backlog buildup
      acknowledge?.();
      return;
    }
    const seq = (metadata.seq ?? 0) | 0;
    io.to(target.socketId).emit("desktop.frame", { ...metadata, sourceDeviceId: senderId, seq, ts: Date.now() }, buffer as ArrayBuffer);
    if (sender) {
      sender.lastFrameTs = Date.now();
      sender.frameSeq = seq;
    }
    acknowledge?.();
  });

  // Control events (JSON, low bandwidth)
  socket.on("session.request", (payload: unknown) => {
    const msg = payload as { targetDeviceId?: string; pairingId?: string };
    const phoneId = socket.data.deviceId as string | undefined;
    if (!msg?.targetDeviceId || !msg.pairingId || !phoneId) return;
    const pairing = pairings.get(msg.pairingId);
    if (!pairing || pairing.ownerDeviceId !== msg.targetDeviceId || pairing.joinedDeviceId !== phoneId || pairing.expiresAt < Date.now()) {
      socket.emit("error", { error: "pairing_not_confirmed" });
      return;
    }
    const target = devices.get(msg.targetDeviceId);
    if (target) io.to(target.socketId).emit("session.request", { sourceDeviceId: phoneId, deviceName: devices.get(phoneId)?.name ?? "Phone" });
  });

  socket.on("session.approve", (payload: unknown) => {
    const msg = payload as { targetDeviceId?: string };
    const ownerId = socket.data.deviceId as string | undefined;
    const phoneId = msg?.targetDeviceId;
    if (!ownerId || !phoneId) return;
    if (!pairedSessionFor(ownerId, phoneId)) {
      const pairing = [...pairings.values()].find((item) => item.ownerDeviceId === ownerId && item.joinedDeviceId === phoneId);
      if (!pairing) return socket.emit("error", { error: "pairing_not_confirmed" });
      activeSessions.set(`${ownerId}:${phoneId}`, { pairingId: [...pairings.entries()].find(([, item]) => item === pairing)?.[0] ?? "", ownerDeviceId: ownerId, phoneDeviceId: phoneId });
    }
    const target = devices.get(phoneId);
    if (target) io.to(target.socketId).emit("session.approve", { sourceDeviceId: ownerId });
  });

  socket.on("session.end", (payload: unknown) => {
    const msg = payload as { targetDeviceId?: string };
    const sourceId = socket.data.deviceId as string | undefined;
    const targetId = msg?.targetDeviceId;
    for (const [key, session] of activeSessions) {
      if (session.ownerDeviceId === sourceId || session.phoneDeviceId === sourceId) {
        const peerId = session.ownerDeviceId === sourceId ? session.phoneDeviceId : session.ownerDeviceId;
        activeSessions.delete(key);
        const peer = devices.get(peerId);
        if (peer) io.to(peer.socketId).emit("session.end", { sourceDeviceId: sourceId });
      }
    }
    if (targetId) {
      const target = devices.get(targetId);
      if (target) io.to(target.socketId).emit("session.end", { sourceDeviceId: sourceId });
    }
  });

  socket.on("session.reject", (payload: unknown) => {
    const msg = payload as { targetDeviceId?: string };
    if (!msg?.targetDeviceId) return;
    const target = devices.get(msg.targetDeviceId);
    if (target) io.to(target.socketId).emit("session.reject", { sourceDeviceId: socket.data.deviceId });
  });

  for (const event of ["webrtc.offer", "webrtc.answer", "webrtc.iceCandidate", "presence.update", "desktop.control", "desktop.controlAck", "desktop.rtt", "desktop.congestion", "file.available"]) {
    socket.on(event, (payload: unknown) => {
      const msg = payload as { targetDeviceId?: string; sourceDeviceId?: string; [key: string]: unknown } | undefined;
      const targetId = msg?.targetDeviceId;
      if (!targetId) return;
      const sourceId = socket.data.deviceId as string | undefined;
      if (["desktop.control", "desktop.controlAck", "desktop.rtt", "desktop.congestion", "file.available"].includes(event)) {
        if (!sourceId || !pairedSessionFor(
          sourceId.startsWith("windows-") ? sourceId : targetId,
          sourceId.startsWith("phone-") ? sourceId : targetId
        )) {
          if (event === "desktop.control") socket.emit("error", { error: "session_not_approved" });
          return;
        }
      }
      const target = devices.get(targetId);
      if (!target) {
        if (event === "desktop.control") socket.emit("error", { error: "target_offline" });
        return;
      }
      if (event === "desktop.rtt" || event === "desktop.congestion") {
        const dev = devices.get(socket.data.deviceId as string);
        if (event === "desktop.rtt" && typeof msg.rttMs === "number" && dev) {
          dev.rttMs = msg.rttMs;
        }
        if (event === "desktop.congestion" && typeof msg.congested === "boolean" && dev) {
          dev.congested = msg.congested;
        }
        io.to(target.socketId).emit(event, { ...msg, sourceDeviceId: socket.data.deviceId });
        return;
      }
      io.to(target.socketId).emit(event, { ...msg, sourceDeviceId: socket.data.deviceId });
    });
  }

  socket.on("disconnect", () => {
    const deviceId = socket.data.deviceId as string | undefined;
    if (deviceId && devices.get(deviceId)?.socketId === socket.id) devices.delete(deviceId);
    for (const [key, session] of activeSessions) {
      if (session.ownerDeviceId === deviceId || session.phoneDeviceId === deviceId) {
        activeSessions.delete(key);
        const peerId = session.ownerDeviceId === deviceId ? session.phoneDeviceId : session.ownerDeviceId;
        const peer = devices.get(peerId);
        if (peer) io.to(peer.socketId).emit("session.end", { sourceDeviceId: deviceId });
      }
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, pairing] of pairings) {
    if (pairing.expiresAt < now) pairings.delete(id);
  }
  for (const [id, transfer] of transfers) {
    if (transfer.expiresAt < now) transfers.delete(id);
  }
  // Clear stale device congestion after 30s of silence
  for (const [deviceId, dev] of devices) {
    if (now - dev.lastFrameTs > 30_000) dev.congested = false;
  }
}, 30_000).unref();

await app.listen({ port, host: "0.0.0.0" });
console.log(`Signaling server listening on :${port}`);
