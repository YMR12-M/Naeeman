/**
 * قطع كارت الأختام وصور القصّات للزبون: صور بتتحمّل بتوكن الحساب (مش في
 * مكان عام)، وصف الأختام، وجملة «فاضلّك كام».
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../lib/icons.jsx';

/** صورة من السيرفر بتوكن. `path` نفسه هو مفتاح التحميل. */
export function AuthImage({ path, alt = '', className = '' }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setFailed(false);
    setUrl(null);
    api.blob(path)
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
  }, [path]);

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

/** «ختم واحد» · «ختمين» · «3 أختام» */
const stampsLeft = (left) => (left === 1 ? 'ختم واحد' : left === 2 ? 'ختمين' : <><span className="num">{left}</span> أختام</>);

/** «فاضلّك 3 وتاخد قص ببلاش» أو «المكافأة جاهزة — الزيارة الجاية» */
export function LoyaltyNote({ loyalty }) {
  if (!loyalty?.enabled) return null;
  return loyalty.eligible
    ? <span className="bold">المكافأة جاهزة — زيارتك الجاية: {loyalty.reward}</span>
    : <span className="small muted">فاضلّك {stampsLeft(loyalty.left)} وتاخد {loyalty.reward}</span>;
}
