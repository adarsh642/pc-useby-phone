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
  relayEvents
} from "./protocol.js";

const app = Fastify({ logger: { redact: ["req.headers.authorization", "secret"] } });
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, payload, done) => {
  done(null, payload);
});
const io = new Server(app.server, { cors: { origin: false } });
const port = Number(process.env.PORT ?? 8787);
const pairingTtlMs = 5 * 60_000;
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const transfers = new Map<string, { name: string; data: Buffer }>();

type Pairing = {
  secretDigest: string;
  ownerDeviceId: string;
  ownerDeviceName: string;
  expiresAt: number;
  joinedDeviceId?: string;
};

const pairings = new Map<string, Pairing>();
const devices = new Map<string, { socketId: string; name: string; publicKey: string }>();

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function secretsMatch(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(digest(provided));
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
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
    id = Array.from({ length: 6 }, () => alphabet[randomBytes(1)[0] % alphabet.length]).join("");
  } while ([...pairings.keys()].includes(id));
  const secret = randomBytes(8).toString("base64url");
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
  const id = randomUUID();
  transfers.set(id, { name, data });
  reply.header("Cache-Control", "no-store");
  return { transferId: id, name, size: data.length };
});

app.get("/transfer/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const transfer = transfers.get(id);
  if (!transfer) return reply.code(404).send({ error: "transfer_not_found" });
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
      publicKey: parsed.data.publicKey
    });
    socket.data.deviceId = parsed.data.deviceId;
    acknowledge?.({ ok: true });
  });

  for (const event of relayEvents) {
    socket.on(event, (payload: { targetDeviceId?: string; [key: string]: unknown }) => {
      const target = payload?.targetDeviceId ? devices.get(payload.targetDeviceId) : undefined;
      if (!target) return socket.emit("error", { error: "target_offline" });
      io.to(target.socketId).emit(event, { ...payload, sourceDeviceId: socket.data.deviceId });
    });
  }

  socket.on("disconnect", () => {
    const deviceId = socket.data.deviceId as string | undefined;
    if (deviceId && devices.get(deviceId)?.socketId === socket.id) devices.delete(deviceId);
  });
});

setInterval(() => {
  for (const [id, pairing] of pairings) {
    if (pairing.expiresAt < Date.now()) pairings.delete(id);
  }
}, 60_000).unref();

await app.listen({ port, host: "0.0.0.0" });
