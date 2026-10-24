/**
 * ماسح QR بالكاميرا الخلفية.
 *
 * BarcodeDetector الأوّل (أندرويد كروم: سريع ومن غير مكتبة)، وإلا jsQR
 * بيتحمّل عند الحاجة بس ويقرا كادر كل ربع ثانية (آيفون سفاري).
 * لو الكاميرا مش متاحة أو الإذن اترفض، `onError` والصفحة بتعرض الكتابة بالإيد.
 */
import { useEffect, useRef } from 'react';

const FRAME_MS = 250;

export default function Scanner({ onResult, onError }) {
  const video = useRef(null);
  const resultRef = useRef(onResult);
  const errorRef = useRef(onError);
  resultRef.current = onResult;
  errorRef.current = onError;

  useEffect(() => {
    let stream = null;
    let timer = null;
    let stopped = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('الكاميرا مش متاحة في المتصفّح ده');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (stopped) return;
      const element = video.current;
      element.srcObject = stream;
      await element.play();

      let detect;
      if ('BarcodeDetector' in window) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        detect = async () => (await detector.detect(element))[0]?.rawValue ?? null;
      } else {
        const { default: jsQR } = await import('jsqr');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        detect = async () => {
          const width = element.videoWidth;
          const height = element.videoHeight;
          if (!width || !height) return null;
          canvas.width = width;
          canvas.height = height;
          context.drawImage(element, 0, 0, width, height);
          return jsQR(context.getImageData(0, 0, width, height).data, width, height)?.data ?? null;
        };
      }

      const tick = async () => {
        if (stopped) return;
        try {
          const text = await detect();
          if (text && resultRef.current(text) === true) return; // اتقبل: نوقف
        } catch { /* كادر بايظ: اللي بعده */ }
        timer = setTimeout(tick, FRAME_MS);
      };
      tick();
    }

    start().catch((error) => {
      errorRef.current?.(error.name === 'NotAllowedError' ? 'الكاميرا مقفولة — اسمح بيها من إعدادات المتصفّح، أو اكتب الكود' : error.message || 'الكاميرا مش شغّالة');
    });

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="scanner">
      <video ref={video} muted playsInline aria-label="الكاميرا" />
      <span className="scanner-frame" aria-hidden="true" />
    </div>
  );
}
