/**
 * قطع صغيرة لكارت الزبون: صورة بتتحمّل بتوكن الدخول، وصف الأختام.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Icon } from '../../lib/icons.jsx';

/**
 * صورة من السيرفر بتوكن (الصور مش في مكان عام). `load` اختياري لو المسار
 * محتاج طريقة تانية (تابلت الكرسي بتوكن الجهاز).
 */
export function AuthImage({ path, alt = '', className = '', load = api.blob }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setFailed(false);
    load(path)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, load]);

  if (failed) return <span className={`photo-missing ${className}`.trim()}><Icon name="camera" size={20} /></span>;
  if (!url) return <span className={`photo-loading ${className}`.trim()} aria-busy="true" />;
  return <img src={url} alt={alt} className={className} />;
}

/** الأختام: دواير مليانة وفاضية، والأخيرة نجمة لو المكافأة جاهزة */
export function StampRow({ loyalty, size = 'md' }) {
  if (!loyalty?.enabled) return null;
  const dots = Array.from({ length: loyalty.required }, (_, index) => index < loyalty.stamps);
  return (
    <div className={`stamp-row ${size}`} role="img" aria-label={`${loyalty.stamps} ختم من ${loyalty.required}`}>
      {dots.map((on, index) => (
        <span key={index} className={`stamp ${on ? 'on' : ''}`.trim()} aria-hidden="true">{on ? <Icon name="scissors" size={12} /> : null}</span>
      ))}
      <span className={`stamp prize ${loyalty.eligible ? 'on' : ''}`.trim()} aria-hidden="true"><Icon name="star" size={13} /></span>
    </div>
  );
}

/** «فاضلّك 3» أو «المكافأة جاهزة» */
export function LoyaltyNote({ loyalty }) {
  if (!loyalty?.enabled) return null;
  return loyalty.eligible
    ? <span className="small bold">المكافأة جاهزة: {loyalty.reward}</span>
    : <span className="small muted">فاضل <span className="num">{loyalty.left}</span> ختم وياخد {loyalty.reward}</span>;
}
