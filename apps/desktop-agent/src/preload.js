const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAgent", {
  getSources: () => ipcRenderer.invoke("capture:sources"),
  startCapture: () => ipcRenderer.send("capture:start"),
  stopCapture: () => ipcRenderer.send("capture:stop"),
  createPairing: () => ipcRenderer.invoke("pairing:create"),
  disconnect: () => ipcRenderer.invoke("session:end"),
  setConsent: (consent) => ipcRenderer.send("consent:set", consent),
  approveRequest: (value) => ipcRenderer.invoke("session:approve", value),
  rejectRequest: (value) => ipcRenderer.invoke("session:reject", value),
  onStatus: (callback) => ipcRenderer.on("status", (_event, value) => callback(value)),
  onPairing: (callback) => ipcRenderer.on("pairing", (_event, value) => callback(value)),
  onSessionRequest: (callback) => ipcRenderer.on("session.request", (_event, value) => callback(value)),
  onCaptureStart: (callback) => ipcRenderer.on("capture:start", () => callback()),
  onCaptureStop: (callback) => ipcRenderer.on("capture:stop", () => callback()),
  onCaptureQuality: (callback) => ipcRenderer.on("capture:quality", (_event, value) => callback(value)),
  frameReady: (image) => ipcRenderer.send("capture:frame", image)
});
