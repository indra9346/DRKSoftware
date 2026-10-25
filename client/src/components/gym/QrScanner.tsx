import { Camera, CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Detection = { rawValue: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detection[]> };
type DetectorConstructor = (new (options: { formats: string[] }) => Detector) & {
  getSupportedFormats?: () => Promise<string[]>;
};
type BarcodeWindow = Window & { BarcodeDetector?: DetectorConstructor };

/** Decodes one video frame; resolves to the QR text or null. */
type FrameDecoder = (video: HTMLVideoElement) => Promise<string | null>;

/**
 * The browser's own BarcodeDetector where it exists (Android, ChromeOS, macOS Chrome);
 * otherwise jsQR, which decodes camera frames in plain JavaScript. Chrome and Edge on Windows,
 * Firefox and desktop Safari have no BarcodeDetector, so without jsQR the front-desk PC could
 * never scan.
 */
async function createDecoder(): Promise<FrameDecoder> {
  const Native = (window as BarcodeWindow).BarcodeDetector;
  const nativeQr = Native
    ? await (Native.getSupportedFormats?.() ?? Promise.resolve(["qr_code"]))
        .then(formats => formats.includes("qr_code"))
        .catch(() => false)
    : false;
  if (Native && nativeQr) {
    const detector = new Native({ formats: ["qr_code"] });
    return async video => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async video => {
    if (!context || !video.videoWidth) return null;
    // Scale large webcam frames down: faster, and still plenty for a badge held up to the camera.
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return (
      jsQR(image.data, image.width, image.height, {
        inversionAttempts: "dontInvert",
      })?.data ?? null
    );
  };
}

const FRAME_GAP_MS = 120;
const TYPE_INSTEAD = "Type the member ID in the search box above.";

export function QrScanner({
  enabled,
  onScan,
}: {
  enabled: boolean;
  onScan: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onScan);
  const [message, setMessage] = useState("");
  const [live, setLive] = useState(false);
  callbackRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer = 0;
    setLive(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(`This browser cannot use the camera here. ${TYPE_INSTEAD}`);
      return;
    }
    setMessage("Starting the camera…");

    const start = async () => {
      let decode: FrameDecoder;
      try {
        decode = await createDecoder();
      } catch {
        setMessage(`The QR reader could not load. ${TYPE_INSTEAD}`);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        if (!stopped)
          setMessage(
            `Camera permission was not granted, or no camera was found. ${TYPE_INSTEAD}`
          );
        return;
      }
      if (stopped || !videoRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
      setLive(true);
      setMessage("Hold the member's QR code inside the frame.");

      const tick = async () => {
        if (stopped) return;
        const video = videoRef.current;
        if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            const raw = await decode(video);
            const scanned = raw?.replace(/^(FITCRUSH|SWAN)[|:]/, "").trim();
            if (scanned && !stopped) {
              callbackRef.current(scanned);
              return;
            }
          } catch {
            /* try the next frame */
          }
        }
        if (!stopped)
          timer = window.setTimeout(() => void tick(), FRAME_GAP_MS);
      };
      void tick();
    };
    void start();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      setLive(false);
    };
  }, [enabled]);

  if (!enabled) return null;
  const failed = !live && message !== "" && !message.startsWith("Starting");
  return (
    <div className="scanner-panel">
      <div className="scanner-head">
        <Camera size={17} />
        <span>Member QR scanner</span>
      </div>
      {/* Only shown once the camera is running: no empty black box on failure. */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="scanner-video"
        aria-label="QR code camera view"
        hidden={!live}
      />
      {message && (
        <p className="scanner-message">
          {failed ? <CameraOff size={14} /> : null}
          {message}
        </p>
      )}
    </div>
  );
}
