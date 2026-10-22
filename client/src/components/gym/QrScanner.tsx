import { Camera, CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Detection = { rawValue: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detection[]> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;
type BarcodeWindow = Window & { BarcodeDetector?: DetectorConstructor };

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
  callbackRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let frame = 0;
    const detectorClass = (window as BarcodeWindow).BarcodeDetector;
    if (!detectorClass) {
      setMessage(
        "QR scanning is not supported in this browser. Enter the member ID below."
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera access is unavailable. Enter the member ID below.");
      return;
    }
    const detector = new detectorClass({ formats: ["qr_code"] });
    const detect = async () => {
      if (
        stopped ||
        !videoRef.current ||
        videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        frame = requestAnimationFrame(detect);
        return;
      }
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length) {
          const scanned = codes[0].rawValue
            .replace(/^(FITCRUSH|SWAN)[|:]/, "")
            .trim();
          if (scanned) {
            callbackRef.current(scanned);
            return;
          }
        }
      } catch {
        /* wait for the next video frame */
      }
      if (!stopped) frame = requestAnimationFrame(detect);
    };
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      })
      .then(media => {
        if (stopped) {
          media.getTracks().forEach(track => track.stop());
          return;
        }
        stream = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          void videoRef.current.play();
        }
        setMessage("Hold a member QR code within the frame.");
        frame = requestAnimationFrame(detect);
      })
      .catch(() =>
        setMessage(
          "Camera permission was not granted. Enter the member ID below."
        )
      );
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div className="scanner-panel">
      <div className="scanner-head">
        <Camera size={17} />
        <span>Member QR scanner</span>
      </div>
      <video
        ref={videoRef}
        playsInline
        muted
        className="scanner-video"
        aria-label="QR code camera view"
      />
      {message && (
        <p className="scanner-message">
          {message.includes("not supported") ||
          message.includes("unavailable") ||
          message.includes("permission") ? (
            <CameraOff size={14} />
          ) : null}
          {message}
        </p>
      )}
    </div>
  );
}
