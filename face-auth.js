/**
 * ============================================================
 * FACE-AUTH.JS — Face Recognition / Biometrics Module
 * Uses face-api.js for face detection and descriptor extraction
 * Compares Euclidean distance between 128-dim face descriptors
 * ============================================================
 */

const FaceAuth = (() => {
  /* ---- Constants ---- */
  const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
  const MATCH_THRESHOLD = 0.50;   // lower = stricter match
  const CAPTURE_DELAY_MS = 400;   // ms between auto-capture attempts
  const REQUIRED_CAPTURES = 5;    // frames averaged for enrollment
  const DETECTION_SCORE = 0.65;   // minimum face detection confidence

  let modelsLoaded = false;
  let stream = null;

  /* ---- Model Loading ---- */

  /**
   * Load required face-api.js models
   */
  async function loadModels(onProgress) {
    if (modelsLoaded) return true;
    try {
      const p = onProgress || (() => {});
      p('Loading face detection model...');
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      p('Loading landmark model...');
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
      p('Loading recognition model...');
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      modelsLoaded = true;
      p('Models ready.');
      return true;
    } catch (err) {
      console.error('Model load error:', err);
      throw new Error('Failed to load face models. Check your internet connection.');
    }
  }

  /* ---- Camera ---- */

  /**
   * Start the webcam and pipe to a <video> element
   */
  async function startCamera(videoEl) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      });
      videoEl.srcObject = stream;
      await new Promise(resolve => {
        videoEl.onloadedmetadata = () => resolve();
      });
      videoEl.play();
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Camera access denied. Please allow camera permissions.');
      }
      throw new Error('Could not access camera: ' + err.message);
    }
  }

  /**
   * Stop all camera tracks
   */
  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  /* ---- Face Detection ---- */

  /**
   * Detect a single face and return its 128-dim descriptor
   * Returns null if no face or low confidence
   */
  async function detectFace(videoEl) {
    const opts = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: DETECTION_SCORE
    });

    const detection = await faceapi
      .detectSingleFace(videoEl, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    return detection || null;
  }

  /**
   * Draw face detection results onto a canvas overlay
   */
  async function drawDetections(videoEl, canvasEl, detection) {
    const dims = faceapi.matchDimensions(canvasEl, videoEl, true);
    canvasEl.getContext('2d').clearRect(0, 0, canvasEl.width, canvasEl.height);

    if (!detection) return;

    const resized = faceapi.resizeResults(detection, dims);
    const box = resized.detection.box;
    const ctx = canvasEl.getContext('2d');

    // Draw glowing face box
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#00f5ff';
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Confidence badge
    const score = Math.round(detection.detection.score * 100);
    ctx.fillStyle = 'rgba(0,245,255,0.85)';
    ctx.fillRect(box.x, box.y - 22, 80, 20);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`CONF: ${score}%`, box.x + 6, box.y - 8);

    // Draw minimal landmarks
    ctx.fillStyle = 'rgba(0,255,136,0.7)';
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#00ff88';
    resized.landmarks.positions.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.5, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  /* ---- Enrollment (Registration) ---- */

  /**
   * Collect multiple face descriptors and return the average
   * descriptor for robust enrollment
   *
   * @param {HTMLVideoElement} videoEl
   * @param {HTMLCanvasElement} canvasEl
   * @param {Function} onStatus — callback(statusText, progress 0-1)
   */
  async function enrollFace(videoEl, canvasEl, onStatus) {
    const descriptors = [];
    const status = onStatus || (() => {});

    status('Scanning face...', 0);

    while (descriptors.length < REQUIRED_CAPTURES) {
      await sleep(CAPTURE_DELAY_MS);
      const detection = await detectFace(videoEl);
      await drawDetections(videoEl, canvasEl, detection);

      if (detection) {
        descriptors.push(detection.descriptor);
        const progress = descriptors.length / REQUIRED_CAPTURES;
        status(
          `Capturing: ${descriptors.length}/${REQUIRED_CAPTURES} frames`,
          progress
        );
      } else {
        status('No face detected — look at the camera', descriptors.length / REQUIRED_CAPTURES);
      }
    }

    // Average the descriptors
    const avg = averageDescriptors(descriptors);
    status('Face enrolled successfully!', 1);
    return avg;
  }

  /* ---- Verification (Login) ---- */

  /**
   * Verify the current face against a stored descriptor
   * Tries multiple frames for robustness
   *
   * @param {HTMLVideoElement} videoEl
   * @param {HTMLCanvasElement} canvasEl
   * @param {Float32Array|number[]} storedDescriptor
   * @param {Function} onStatus
   * @returns {object} { verified: bool, distance: number, confidence: string }
   */
  async function verifyFace(videoEl, canvasEl, storedDescriptor, onStatus) {
    const stored = new Float32Array(storedDescriptor);
    const status = onStatus || (() => {});
    const MAX_ATTEMPTS = 20;
    let attempts = 0;
    let bestDistance = Infinity;

    status('Look at the camera...', 0);

    while (attempts < MAX_ATTEMPTS) {
      await sleep(CAPTURE_DELAY_MS);
      attempts++;
      const detection = await detectFace(videoEl);
      await drawDetections(videoEl, canvasEl, detection);

      if (!detection) {
        status('Position your face in the frame', attempts / MAX_ATTEMPTS);
        continue;
      }

      const distance = faceapi.euclideanDistance(
        detection.descriptor,
        stored
      );

      if (distance < bestDistance) bestDistance = distance;

      const progress = attempts / MAX_ATTEMPTS;
      const conf = Math.round((1 - distance) * 100);
      status(`Matching: ${conf}% similarity`, progress);

      if (distance <= MATCH_THRESHOLD) {
        status('Face verified!', 1);
        return {
          verified: true,
          distance,
          confidence: conf + '%',
          attempts
        };
      }
    }

    return {
      verified: false,
      distance: bestDistance,
      confidence: Math.round((1 - bestDistance) * 100) + '%',
      attempts
    };
  }

  /* ---- Helpers ---- */

  function averageDescriptors(descriptors) {
    const len = descriptors[0].length;
    const avg = new Float32Array(len);
    for (const d of descriptors) {
      for (let i = 0; i < len; i++) avg[i] += d[i];
    }
    for (let i = 0; i < len; i++) avg[i] /= descriptors.length;
    return avg;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isModelsLoaded() { return modelsLoaded; }

  return {
    loadModels,
    startCamera,
    stopCamera,
    detectFace,
    drawDetections,
    enrollFace,
    verifyFace,
    isModelsLoaded,
    MATCH_THRESHOLD
  };
})();

window.FaceAuth = FaceAuth;
