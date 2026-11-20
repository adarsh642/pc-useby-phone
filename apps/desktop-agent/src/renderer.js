let captureStream = null;
let captureTimer = null;
let captureQuality = "balanced";
let lastPointerSentAt = 0;

const status = document.querySelector("#status");
const consent = document.querySelector("#consent");
const pairingId = document.querySelector("#pairingId");
const secret = document.querySelector("#secret");
const expiry = document.querySelector("#expiry");

window.desktopAgent.onStatus((value) => status.textContent = value);
window.desktopAgent.onCaptureStart(() => beginCapture().catch((error) => status.textContent = `Capture failed: ${error.message}`));
window.desktopAgent.onCaptureStop?.(() => stopCapture());
window.desktopAgent.onCaptureQuality?.((quality) => {
  captureQuality = quality;
  if (captureStream) beginCapture().catch((error) => status.textContent = `Capture failed: ${error.message}`);
});
window.desktopAgent.onPairing((value) => {
  pairingId.value = value.pairingId;
  secret.value = value.secret;
  expiry.textContent = `Expires: ${new Date(value.expiresAt).toLocaleString()}`;
});
window.desktopAgent.onSessionRequest((value) => {
  const request = document.querySelector("#request");
  document.querySelector("#requestText").textContent = `${value.deviceName} wants to connect`;
  request.style.display = "block";
  document.querySelector("#approve").onclick = () => {
    window.desktopAgent.approveRequest(value);
    request.style.display = "none";
  };
  document.querySelector("#reject").onclick = () => {
    window.desktopAgent.rejectRequest(value);
    request.style.display = "none";
  };
});

document.querySelector("#pairing").addEventListener("click", () => window.desktopAgent.createPairing());
document.querySelector("#disconnect").addEventListener("click", () => window.desktopAgent.disconnect());
consent.addEventListener("change", () => window.desktopAgent.setConsent(consent.checked));

async function beginCapture() {
  stopCapture();
  const sources = await window.desktopAgent.getSources();
  const source = sources.find((item) => item.id.startsWith("screen")) ?? sources[0];
  if (!source) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: source.id,
        maxWidth: captureQuality === "high" ? 1920 : captureQuality === "low" ? 854 : 1280,
        maxHeight: captureQuality === "high" ? 1080 : captureQuality === "low" ? 480 : 720,
        maxFrameRate: captureQuality === "high" ? 8 : captureQuality === "low" ? 4 : 6
      }
    }
  });
  captureStream = stream;
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  clearInterval(captureTimer);
  captureTimer = setInterval(() => {
    if (!video.videoWidth) return;
    const scale = captureQuality === "high"
      ? Math.min(1, 1200 / video.videoWidth)
      : captureQuality === "low"
        ? Math.min(1, 640 / video.videoWidth)
        : Math.min(1, 800 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const jpegQuality = captureQuality === "high" ? 0.65 : captureQuality === "low" ? 0.38 : 0.50;
    window.desktopAgent.frameReady(canvas.toDataURL("image/jpeg", jpegQuality));
  }, captureQuality === "high" ? 125 : captureQuality === "low" ? 300 : 170);
}

function stopCapture() {
  clearInterval(captureTimer);
  captureTimer = null;
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
}
