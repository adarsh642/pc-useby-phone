const socket = io({ transports: ["websocket", "polling"] });
const pairing = document.querySelector("#pairing");
const session = document.querySelector("#session");
const status = document.querySelector("#status");
const canvas = document.querySelector("#screen");
const context = canvas.getContext("2d", { alpha: false });
let targetDeviceId = "";
let lastPointerMoveSentAt = 0;
const pointerThrottleMs = 16; // ~60fps cursor updates
const randomId = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const deviceId = `phone-${randomId}`;
let keyboardText = "";
let pingSentAt = 0;
let touchStart = null;
let touchMoved = false;
let rttMs = 0;
let congested = false;

// Binary frame buffering (double buffer via requestAnimationFrame)
let pendingFrame = null; // { bitmap: ImageBitmap, ts, seq }
let lastDrawnSeq = -1;
let rafId = null;
let displayWidth = 0;
let displayHeight = 0;

function setStatusLabel(text, state = "") {
  status.textContent = text;
  status.className = state;
}

function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    renderFrame();
  });
}

function renderFrame() {
  if (!pendingFrame) return;
  const { bitmap, ts, seq } = pendingFrame;
  if (seq <= lastDrawnSeq) {
    pendingFrame = null;
    return;
  }
  lastDrawnSeq = seq;
  if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
  if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
  displayWidth = bitmap.width;
  displayHeight = bitmap.height;
  context.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === "function") bitmap.close();
  pendingFrame = null;
  // Schedule next frame if one arrived while rendering
  if (pendingFrame) scheduleRender();
}

document.querySelector("#pairingId").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5);
});

document.querySelector("#secret").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
});

document.querySelector("#connect").addEventListener("click", async () => {
  const pairingIdValue = document.querySelector("#pairingId").value.trim();
  const secret = document.querySelector("#secret").value.trim();
  if (!pairingIdValue || !secret) {
    status.textContent = "Enter pairing ID and secret";
    return;
  }
  status.textContent = "Joining...";
  try {
    const response = await fetch("/pairing/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingId: pairingIdValue, secret, deviceId, deviceName: "Phone browser" })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    targetDeviceId = body.ownerDeviceId;
    socket.emit("auth.device", {
      deviceId,
      deviceName: "Phone browser",
      publicKey: `browser-public-key-${deviceId}`
    }, (auth) => {
      if (!auth?.ok) {
        status.textContent = "Device authentication failed";
        return;
      }
      socket.emit("session.request", { targetDeviceId, pairingId: pairingIdValue });
    });
  } catch (error) {
    status.textContent = `Connection failed: ${error.message}`;
  }
});

socket.on("session.approve", () => {
  pairing.hidden = true;
  session.hidden = false;
  setStatusLabel("Connected", "connected");
  pingSentAt = performance.now();
  socket.emit("desktop.control", { type: "ping", targetDeviceId, sentAt: pingSentAt });
  pingTimer = setInterval(() => {
    pingSentAt = performance.now();
    socket.emit("desktop.control", { type: "ping", targetDeviceId, sentAt: pingSentAt });
  }, 1000);
});

let pingTimer;

socket.on("session.reject", () => {
  status.textContent = "Windows PC rejected the connection";
});

socket.on("session.end", () => {
  clearInterval(pingTimer);
  cancelAnimationFrame(rafId);
  rafId = null;
  pendingFrame = null;
  lastDrawnSeq = -1;
  context.clearRect(0, 0, canvas.width, canvas.height);
  pairing.hidden = false;
  session.hidden = true;
  setStatusLabel("Disconnected");
});

socket.on("desktop.controlAck", (payload) => {
  if (payload?.type === "ping" && pingSentAt) {
    const latency = Math.round(performance.now() - pingSentAt);
    rttMs = latency;
    setStatusLabel(`Connected • ${latency} ms`, latency > 500 ? "degraded" : "connected");
    // Report congestion back to desktop so it can throttle
    const nowCongested = latency > 300;
    if (nowCongested !== congested) {
      congested = nowCongested;
      socket.emit("desktop.congestion", { targetDeviceId, congested });
    }
    // Tell desktop our measured RTT for adaptive quality
    socket.emit("desktop.rtt", { targetDeviceId, rttMs: latency });
  }
});

socket.on("desktop.frame", (metadata, buffer) => {
  if (!buffer) return;
  const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
  try {
    const blob = new Blob([arrayBuffer], { type: "image/jpeg" });
    createImageBitmap(blob).then((bitmap) => {
      pendingFrame = { bitmap, ts: metadata?.ts ?? Date.now(), seq: metadata?.seq ?? 0 };
      scheduleRender();
    }).catch(() => {
      // Fallback: decode via Image
      const image = new Image();
      image.onload = () => {
        pendingFrame = { bitmap: image, ts: metadata?.ts ?? Date.now(), seq: metadata?.seq ?? 0 };
        scheduleRender();
      };
      image.src = URL.createObjectURL(blob);
    });
  } catch {
    // ignore undecodable frame
  }
});

function sendControl(control) {
  if (targetDeviceId) socket.emit("desktop.control", { ...control, targetDeviceId });
}

function canvasRect() {
  return canvas.getBoundingClientRect();
}

function normalizedCoords(event) {
  const rect = canvasRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

canvas.addEventListener("pointermove", (event) => {
  const now = performance.now();
  if (now - lastPointerMoveSentAt < pointerThrottleMs) return;
  lastPointerMoveSentAt = now;
  const { x, y } = normalizedCoords(event);
  sendControl({ type: "mouseMove", x, y });
}, { passive: false });

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  touchStart = { x: event.clientX, y: event.clientY, time: performance.now() };
  touchMoved = false;
  if (event.pointerType === "mouse") {
    const { x, y } = normalizedCoords(event);
    sendControl({ type: "mouseDown", x, y, button: event.button === 2 ? "right" : "left" });
  }
}, { passive: false });

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener("pointerup", (event) => {
  if (touchStart) {
    const distance = Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y);
    const duration = performance.now() - touchStart.time;
    if (!touchMoved && distance < 10 && duration < 500) {
      const { x, y } = normalizedCoords(event);
      sendControl({ type: "mouseDown", x, y, button: "left" });
      setTimeout(() => sendControl({ type: "mouseUp", button: "left" }), 35);
    }
  }
  touchStart = null;
  const { x, y } = normalizedCoords(event);
  sendControl({ type: "mouseUp", button: event.button === 2 ? "right" : "left" });
}, { passive: false });

canvas.addEventListener("touchmove", (event) => {
  if (touchStart) {
    const distance = Math.hypot(event.touches[0].clientX - touchStart.x, event.touches[0].clientY - touchStart.y);
    if (distance > 10) touchMoved = true;
  }
}, { passive: false });

document.querySelector("#disconnect").addEventListener("click", () => {
  const myTarget = targetDeviceId;
  // Reset local UI immediately so the screen does not stay stuck on the last frame
  clearInterval(pingTimer);
  pingTimer = null;
  cancelAnimationFrame(rafId);
  rafId = null;
  pendingFrame = null;
  lastDrawnSeq = -1;
  context.clearRect(0, 0, canvas.width, canvas.height);
  pairing.hidden = false;
  session.hidden = true;
  targetDeviceId = "";
  setStatusLabel("Disconnected");
  // Ask the server to end the session and stop the desktop capture
  socket.emit("session.end", { targetDeviceId: myTarget });
});

document.querySelector("#keyboardToggle").addEventListener("click", () => {
  const panel = document.querySelector("#keyboardPanel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) document.querySelector("#keyboardInput").focus();
});

document.querySelector("#keyboardInput").addEventListener("input", (event) => {
  const value = event.target.value;
  const added = value.startsWith(keyboardText)
    ? value.slice(keyboardText.length)
    : value;
  keyboardText = value;
  if (added) sendControl({ type: "text", text: added });
  if (keyboardText && keyboardText.length > 2048) {
    keyboardText = keyboardText.slice(-2048);
    event.target.value = keyboardText;
  }
});

document.querySelector("#keyboardInput").addEventListener("keydown", (event) => {
  if (event.key === "Backspace") {
    keyboardText = keyboardText.slice(0, -1);
    sendControl({ type: "key", key: "Backspace" });
  } else if (event.key.length === 1) {
    keyboardText += event.key;
  } else if (event.key === "Enter") {
    sendControl({ type: "key", key: "Enter" });
  }
});

document.querySelector("#quality").addEventListener("change", (event) => {
  sendControl({ type: "quality", quality: event.target.value });
});

document.querySelectorAll("[data-key]").forEach((button) => {
  button.addEventListener("click", () => {
    sendControl({ type: "key", key: button.dataset.key });
  });
});

canvas.addEventListener("keydown", (event) => {
  event.preventDefault();
  sendControl({ type: "key", key: event.key, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
});

document.querySelector("#file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file || !targetDeviceId) return;
  if (file.size > 25 * 1024 * 1024) {
    status.textContent = "File is too large (25 MB limit)";
    return;
  }
  status.textContent = `Uploading ${file.name}...`;
  const response = await fetch("/transfer/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": file.name
    },
    body: file
  });
  const transfer = await response.json();
  if (!response.ok) {
    status.textContent = "Upload failed";
    return;
  }
  socket.emit("file.available", {
    targetDeviceId,
    transferId: transfer.transferId,
    name: transfer.name,
    size: transfer.size
  });
  status.textContent = `Sent ${file.name} to the Windows PC`;
});
