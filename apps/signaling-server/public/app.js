const socket = io();
const pairing = document.querySelector("#pairing");
const session = document.querySelector("#session");
const status = document.querySelector("#status");
const canvas = document.querySelector("#screen");
const context = canvas.getContext("2d");
let targetDeviceId = "";
let lastPointerMoveSentAt = 0;
const randomId = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const deviceId = `phone-${randomId}`;
let keyboardText = "";
let pingSentAt = 0;
let pingTimer;
let touchStart = null;
let touchMoved = false;

function setStatusLabel(text, state = "") {
  status.textContent = text;
  status.className = state;
}

document.querySelector("#pairingId").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
});

document.querySelector("#secret").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
});

document.querySelector("#connect").addEventListener("click", async () => {
  const pairingId = document.querySelector("#pairingId").value.trim();
  const secret = document.querySelector("#secret").value.trim();
  if (!pairingId || !secret) {
    status.textContent = "Enter pairing ID and secret";
    return;
  }
  status.textContent = "Joining...";
  try {
    const response = await fetch("/pairing/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairingId, secret, deviceId, deviceName: "Phone browser" })
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
      socket.emit("session.request", { targetDeviceId, pairingId });
    });
  } catch (error) {
    status.textContent = `Connection failed: ${error.message}`;
  }
});

socket.on("session.approve", () => {
  pairing.hidden = true;
  session.hidden = false;
  setStatusLabel("Connected", "connected");
  pingTimer = setInterval(() => {
    pingSentAt = performance.now();
    sendControl({ type: "ping", sentAt: pingSentAt });
  }, 2000);
});

socket.on("session.reject", () => {
  status.textContent = "Windows PC rejected the connection";
});

socket.on("session.end", () => {
  clearInterval(pingTimer);
  pairing.hidden = false;
  session.hidden = true;
  setStatusLabel("Disconnected");
});

socket.on("desktop.controlAck", (payload) => {
  if (payload?.type === "ping" && pingSentAt) {
    const latency = Math.round(performance.now() - pingSentAt);
    setStatusLabel(`Connected • ${latency} ms`, latency > 500 ? "degraded" : "connected");
  }
});

socket.on("desktop.frame", (payload) => {
  if (!payload?.image) return;
  const image = new Image();
  image.onload = () => {
    if (canvas.width !== image.width) canvas.width = image.width;
    if (canvas.height !== image.height) canvas.height = image.height;
    context.drawImage(image, 0, 0);
  };
  image.src = payload.image;
});

function sendControl(control) {
  if (targetDeviceId) socket.emit("desktop.control", { ...control, targetDeviceId });
}

canvas.addEventListener("pointermove", (event) => {
  const now = performance.now();
  if (now - lastPointerMoveSentAt < 50) return;
  lastPointerMoveSentAt = now;
  const rect = canvas.getBoundingClientRect();
  if (touchStart) {
    const distance = Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y);
    if (distance > 10) touchMoved = true;
  }
  sendControl({
    type: "mouseMove",
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height
  });
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  touchStart = { x: event.clientX, y: event.clientY, time: performance.now() };
  touchMoved = false;
  if (event.pointerType === "mouse") {
  const rect = canvas.getBoundingClientRect();
  sendControl({
    type: "mouseDown",
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
    button: event.button === 2 ? "right" : "left"
  });
  }
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener("pointerup", (event) => {
  if (touchStart) {
    const distance = Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y);
    const duration = performance.now() - touchStart.time;
    if (!touchMoved && distance < 10 && duration < 500) {
      sendControl({ type: "mouseDown", x: (event.clientX - canvas.getBoundingClientRect().left) / canvas.getBoundingClientRect().width, y: (event.clientY - canvas.getBoundingClientRect().top) / canvas.getBoundingClientRect().height, button: "left" });
      setTimeout(() => sendControl({ type: "mouseUp", button: "left" }), 35);
    }
  }
  touchStart = null;
  sendControl({ type: "mouseUp", button: event.button === 2 ? "right" : "left" });
});

document.querySelector("#disconnect").addEventListener("click", () => {
  socket.emit("session.end", { targetDeviceId });
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
