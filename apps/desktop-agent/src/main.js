const { app, BrowserWindow, desktopCapturer, ipcMain } = require("electron");
const { io } = require("socket.io-client");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const serverUrl = process.env.REMOTE_PC_SERVER_URL || "http://localhost:8787";
const deviceId = `windows-${randomUUID()}`;
let mainWindow;
let socket;
let activePhoneId;
let consentEnabled = true;
let latestMouseMove;
let mouseMoveTimer;
let controlProcess;
let rttMs = 0;
let lastPingSentAt = 0;
let congestionBackoff = 1; // multiplier on capture interval

function setStatus(value) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status", value);
  }
}

function startControlProcess() {
  if (controlProcess) return;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Name MouseNative -Namespace RemotePc -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags,uint dx,uint dy,uint dwData,int dwExtraInfo);'
$shell = New-Object -ComObject WScript.Shell
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $control = $line | ConvertFrom-Json
    $v = [System.Windows.Forms.SystemInformation]::VirtualScreen
    if ($control.type -eq 'mouseMove') {
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]($v.Left + [double]$control.x * $v.Width), [int]($v.Top + [double]$control.y * $v.Height))
    } elseif ($control.type -eq 'mouseDown') {
      $flag = if ($control.button -eq 'right') { 8 } else { 2 }
      [RemotePc.MouseNative]::mouse_event([uint32]$flag,0,0,0,0)
    } elseif ($control.type -eq 'mouseUp') {
      $flag = if ($control.button -eq 'right') { 16 } else { 4 }
      [RemotePc.MouseNative]::mouse_event([uint32]$flag,0,0,0,0)
    } elseif ($control.type -eq 'key') {
      $shell.SendKeys([string]$control.sendKey)
    }
  } catch {}
}
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  controlProcess = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    windowsHide: true,
    stdio: ["pipe", "ignore", "ignore"]
  });
  controlProcess.on("error", (error) => setStatus(`Control error: ${error.message}`));
  controlProcess.on("exit", () => { controlProcess = undefined; });
}

function sendControl(control) {
  if (!controlProcess) startControlProcess();
  controlProcess?.stdin.write(`${JSON.stringify(control)}\n`);
}

async function createPairing() {
  try {
    const response = await fetch(`${serverUrl}/pairing/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, deviceName: os.hostname() })
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const pairing = await response.json();
    mainWindow.webContents.send("pairing", pairing);
    setStatus("Waiting for phone");
  } catch (error) {
    setStatus(`Pairing failed: ${error.message}`);
  }
}

function applyMouseControl(control) {
  if (control.type === "mouseMove") {
    latestMouseMove = {
      x: Math.max(0, Math.min(1, Number(control.x) || 0)),
      y: Math.max(0, Math.min(1, Number(control.y) || 0))
    };
    return;
  }
  if (control.type === "mouseDown") {
    const x = Math.max(0, Math.min(1, Number(control.x) || 0));
    const y = Math.max(0, Math.min(1, Number(control.y) || 0));
    sendControl({ type: "mouseMove", x, y });
    sendControl({ type: "mouseDown", button: control.button });
  }
  if (control.type === "mouseUp") {
    sendControl({ type: "mouseUp", button: control.button });
  }
  if (control.type === "key") {
    const keyMap = {
      Enter: "{ENTER}", Escape: "{ESC}", Tab: "{TAB}", Backspace: "{BACKSPACE}",
      ArrowUp: "{UP}", ArrowDown: "{DOWN}", ArrowLeft: "{LEFT}", ArrowRight: "{RIGHT}",
      " ": " "
    };
    const raw = String(control.key ?? "");
    const sendKey = keyMap[raw] ?? (raw.length === 1 ? raw.replace(/[+^%~{}[\]]/g, "{$&}") : "");
    if (sendKey) {
      const prefix = control.ctrl ? "^" : control.alt ? "%" : control.shift ? "+" : "";
      sendControl({ type: "key", sendKey: prefix + sendKey });
    }
  }
  if (control.type === "text") {
    const text = String(control.text ?? "").slice(0, 2048);
    const sendKey = text
      .replace(/\r\n|\r|\n/g, "{ENTER}")
      .replace(/[+^%~{}[\]]/g, (character) => {
        if (character === "{") return "{{}";
        if (character === "}") return "{}}";
        return `{${character}}`;
      });
    if (sendKey) sendControl({ type: "key", sendKey });
  }
  if (control.type === "quality") {
    const quality = ["low", "balanced", "high"].includes(control.quality) ? control.quality : "balanced";
    mainWindow.webContents.send("capture:quality", quality);
  }
  if (control.type === "ping") {
    lastPingSentAt = control.sentAt;
    socket.emit("desktop.controlAck", {
      targetDeviceId: activePhoneId,
      type: "ping",
      sentAt: control.sentAt
    });
  }
  if (control.type === "rtt") {
    rttMs = control.rttMs ?? 0;
    mainWindow.webContents.send("capture:rtt", rttMs);
  }
}

function adaptQualityFromRtt() {
  // Tell the renderer to adjust capture framerate based on measured RTT
  let interval;
  if (rttMs > 250) interval = "low";
  else if (rttMs > 120) interval = "balanced";
  else interval = "high";
  mainWindow.webContents.send("capture:quality", interval);
}

async function downloadFile(payload) {
  try {
    const response = await fetch(`${serverUrl}/transfer/${payload.transferId}`);
    if (!response.ok) throw new Error(`Transfer returned ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    const downloads = app.getPath("downloads");
    await mkdir(downloads, { recursive: true });
    const safeName = String(payload.name || "transfer.bin").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
    await writeFile(path.join(downloads, safeName), data);
    setStatus(`Received file: ${safeName}`);
  } catch (error) {
    setStatus(`File transfer failed: ${error.message}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 520,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

app.on("before-quit", () => {
  clearInterval(mouseMoveTimer);
  if (controlProcess) {
    controlProcess.stdin?.end();
    controlProcess.kill();
  }
  if (socket) socket.close();
});

app.whenReady().then(() => {
  createWindow();
  socket = io(serverUrl, { transports: ["websocket", "polling"] });
  // Faster mouse flush: 16ms (~60fps cursor)
  mouseMoveTimer = setInterval(() => {
    if (!latestMouseMove || !activePhoneId) return;
    const { x, y } = latestMouseMove;
    latestMouseMove = undefined;
    sendControl({ type: "mouseMove", x, y });
  }, 16);

  socket.on("connect", () => {
    socket.emit("auth.device", {
      deviceId,
      deviceName: os.hostname(),
      publicKey: `desktop-public-key-${deviceId}`
    }, (result) => {
      setStatus(result?.ok ? "Disconnected" : "Authentication failed");
    });
  });

  socket.on("disconnect", () => setStatus("Signaling disconnected"));

  socket.on("session.request", (payload) => {
    if (!consentEnabled) {
      socket.emit("session.reject", { targetDeviceId: payload.sourceDeviceId });
      return;
    }
    mainWindow.webContents.send("session.request", {
      sourceDeviceId: payload.sourceDeviceId,
      deviceName: "Phone browser"
    });
  });

  socket.on("desktop.control", (payload) => {
    if (payload?.sourceDeviceId !== activePhoneId) return;
    applyMouseControl(payload);
  });

  socket.on("file.available", (payload) => {
    if (payload?.sourceDeviceId === activePhoneId) downloadFile(payload);
  });

  socket.on("desktop.rtt", (payload) => {
    if (payload?.sourceDeviceId !== activePhoneId) return;
    const now = Date.now();
    const rtt = now - (payload.sentAt || now);
    rttMs = rtt;
    adaptQualityFromRtt();
    socket.emit("desktop.controlAck", {
      targetDeviceId: activePhoneId,
      type: "ping",
      sentAt: payload.sentAt
    });
  });

  socket.on("desktop.congestion", (payload) => {
    if (payload?.sourceDeviceId !== activePhoneId) return;
    congestionBackoff = payload.congested ? 2 : 1;
    mainWindow.webContents.send("capture:congestion", congestionBackoff);
  });

  socket.on("session.end", () => {
    activePhoneId = undefined;
    latestMouseMove = undefined;
    mainWindow.webContents.send("capture:stop");
    setStatus("Disconnected");
  });

  ipcMain.handle("pairing:create", createPairing);
  ipcMain.handle("session:end", () => {
    if (activePhoneId) socket.emit("session.end", { targetDeviceId: activePhoneId });
    activePhoneId = undefined;
    latestMouseMove = undefined;
    mainWindow.webContents.send("capture:stop");
    setStatus("Disconnected");
  });
  ipcMain.handle("session:approve", (_event, payload) => {
    activePhoneId = payload.sourceDeviceId;
    startControlProcess();
    socket.emit("session.approve", { targetDeviceId: payload.sourceDeviceId });
    mainWindow.webContents.send("capture:start");
    setStatus("Connected");
  });
  ipcMain.handle("session:reject", (_event, payload) => {
    socket.emit("session.reject", { targetDeviceId: payload.sourceDeviceId });
    setStatus("Connection rejected");
  });
  ipcMain.on("consent:set", (_event, value) => {
    consentEnabled = Boolean(value);
  });
  ipcMain.handle("capture:sources", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
    return sources.map((source) => ({ id: source.id, name: source.name }));
  });
  // Receive binary frame (ArrayBuffer + metadata) from renderer, relay as binary
  ipcMain.on("capture:frame", (_event, image, metadata) => {
    if (!activePhoneId) return;
    const frame = {
      ...metadata,
      targetDeviceId: activePhoneId,
      sourceDeviceId: deviceId,
      rttMs,
      congestion: congestionBackoff > 1
    };
    socket.emit("desktop.frame", frame, image, () => {
      // Tell the renderer the frame is in flight so it can capture the next one
      mainWindow.webContents.send("capture:frame-ack");
    });
  });
});
