/**
 * «على واي فاي المحل»: روابط الأجهزة وتطبيق الزبون بـ QR، تتفتح من التابلت
 * أو موبايل الزبون وهو على شبكة المحل. بتظهر في وضع «المحل هو السيرفر» بس.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Icon } from '../../lib/icons.jsx';
import { customerOrigin, lanOrigin } from '../../lib/hub.js';
import { Notice } from '../ui/index.js';

export function Qr({ text, label }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#143C38', light: '#E9F1EE' } })
      .then((markup) => { if (alive) setSvg(markup); });
    return () => { alive = false; };
  }, [text]);
  return <span className="qr lan-qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function LanLinks({ hub, shopSlug }) {
  if (!hub?.enabled) return null;
  const api = lanOrigin(hub, hub.api_port);
  if (!api) {
    return <Notice tone="warn" icon="alert">الكمبيوتر مش متوصّل بشبكة (واي فاي أو كابل) — التابلت والتلفزيون مش هيقدروا يفتحوا اللوحة. وصّله براوتر المحل.</Notice>;
  }
  const customer = customerOrigin(hub);
  const links = [
    { key: 'display', label: 'التلفزيون', icon: 'tv', url: `${api}/display` },
    { key: 'kiosk', label: 'تابلت الباب', icon: 'door', url: `${api}/kiosk` },
    { key: 'chair', label: 'تابلت الكرسي', icon: 'chair', url: `${api}/chair` },
    ...(customer && shopSlug ? [{ key: 'customer', label: 'تطبيق الزبون', icon: 'phone', url: `${customer}/s/${shopSlug}` }] : []),
  ];

  return (
    <section className="panel lan-links">
      <div className="panel-head"><h2 className="panel-title">على واي فاي المحل</h2></div>
      <div className="panel-body stack">
        <p className="small muted">افتح الرابط ده على الجهاز (أو صوّر الـ QR) وهو متوصّل بواي فاي المحل. جوّه المحل كل حاجة بتشتغل حتى لو النت قطع.</p>
        <ul className="lan-list">
          {links.map((link) => (
            <li key={link.key}>
              <Qr text={link.url} label={`QR ${link.label}`} />
              <span className="stack sm">
                <span className="row tight bold"><Icon name={link.icon} size={18} />{link.label}</span>
                <code className="ltr shop-link">{link.url}</code>
              </span>
            </li>
          ))}
        </ul>
        {hub.addresses.length > 1 && <p className="xsmall muted">الكمبيوتر على أكتر من شبكة. لو الرابط مش بيفتح جرّب عنوان تاني: {hub.addresses.slice(1).map((item) => <code key={item.address} className="ltr"> {item.address} </code>)}</p>}
      </div>
    </section>
  );
}
