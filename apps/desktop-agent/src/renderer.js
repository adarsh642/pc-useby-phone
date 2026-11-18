let captureStream = null;
let captureTimer = null;
let lastPointerSentAt = 0;

const status = document.querySelector("#status");
const consent = document.querySelector("#consent");
const pairingId = document.querySelector("#pairingId");
const secret = document.querySelector("#secret");
const expiry = document.querySelector("#expiry");

window.desktopAgent.onStatus((value) => status.textContent = value);
window.desktopAgent.onCaptureStart(() => beginCapture().catch((error) => status.textContent = `Capture failed: ${error.message}`));
window.desktopAgent.onCaptureStop?.(() => stopCapture());
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
  const sources = await window.desktopAgent.getSources();
  const source = sources.find((item) => item.id.startsWith("screen")) ?? sources[0];
  if (!source) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: source.id,
        maxWidth: 1280,
        maxHeight: 720,
        maxFrameRate: 6
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
    const scale = Math.min(1, 800 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    window.desktopAgent.frameReady(canvas.toDataURL("image/jpeg", 0.50));
  }, 170);
}

function stopCapture() {
  clearInterval(captureTimer);
  captureTimer = null;
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
}
