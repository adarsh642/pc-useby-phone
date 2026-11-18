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
  status.textContent = "Connected";
});

socket.on("session.reject", () => {
  status.textContent = "Windows PC rejected the connection";
});

socket.on("session.end", () => {
  pairing.hidden = false;
  session.hidden = true;
  status.textContent = "Disconnected";
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
  sendControl({
    type: "mouseMove",
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height
  });
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  sendControl({
    type: "mouseDown",
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
    button: event.button === 2 ? "right" : "left"
  });
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener("pointerup", (event) => {
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
  } else if (event.key.length === 1) {
    keyboardText += event.key;
  }
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
