let captureStream = null;
let captureTimer = null;
let captureQuality = "balanced";
let isPaused = false;
let frameSeq = 0;
let lastFrameTs = 0;
let minIntervalMs = 160; // balanced default (~6 fps)
let awaitingAck = false; // true while a captured frame is in flight to the phone
let captureRaf = null; // requestAnimationFrame id for the capture loop

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
  minIntervalMs = quality === "high" ? 60 : quality === "low" ? 250 : 160;
  awaitingAck = false;
  if (captureStream) restartCapture();
});
window.desktopAgent.onFrameAck?.(() => {
  awaitingAck = false;
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
        maxFrameRate: captureQuality === "high" ? 30 : captureQuality === "low" ? 8 : 10
      }
    }
  });
  captureStream = stream;
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let nextTick = 0;

  function scheduleCapture() {
    if (isPaused) return;
    cancelAnimationFrame(captureRaf);
    captureRaf = requestAnimationFrame(tick);
  }

  function tick() {
    captureRaf = null;
    if (isPaused) return;
    if (!video.videoWidth) {
      scheduleCapture();
      return;
    }
    const now = performance.now();
    if (now < nextTick) {
      scheduleCapture();
      return;
    }
    if (awaitingAck) {
      // Previous frame still in flight: drop this frame so latency cannot build up
      scheduleCapture();
      return;
    }
    const scale = captureQuality === "high"
      ? Math.min(1, 1280 / video.videoWidth)
      : captureQuality === "low"
        ? Math.min(1, 640 / video.videoWidth)
        : Math.min(1, 854 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const jpegQuality = captureQuality === "high" ? 0.70 : captureQuality === "low" ? 0.35 : 0.50;
    canvas.toBlob((blob) => {
      if (!blob) {
        nextTick = performance.now() + minIntervalMs;
        scheduleCapture();
        return;
      }
      lastFrameTs = performance.now();
      const abReader = new FileReader();
      abReader.onload = () => {
        const arrayBuffer = abReader.result;
        if (!(arrayBuffer instanceof ArrayBuffer)) {
          nextTick = performance.now() + minIntervalMs;
          scheduleCapture();
          return;
        }
        frameSeq += 1;
        awaitingAck = true;
        window.desktopAgent.frameReady(arrayBuffer, {
          quality: captureQuality,
          width: canvas.width,
          height: canvas.height,
          ts: lastFrameTs,
          seq: frameSeq
        });
        nextTick = performance.now() + minIntervalMs;
        scheduleCapture();
      };
      abReader.readAsArrayBuffer(blob);
    }, "image/jpeg", jpegQuality);
  }
  nextTick = performance.now();
  scheduleCapture();
}

function restartCapture() {
  if (!captureStream) return;
  stopCapture();
  beginCapture();
}

function stopCapture() {
  isPaused = true;
  awaitingAck = false;
  clearTimeout(captureTimer);
  captureTimer = null;
  cancelAnimationFrame(captureRaf);
  captureRaf = null;
  captureStream?.getTracks().forEach((track) => track.stop());
  captureStream = null;
  isPaused = false;
}

window.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCapture();
  else if (!isPaused) beginCapture();
});
