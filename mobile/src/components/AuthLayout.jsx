import { Mirror, Sign, Wordmark } from './brand/index.jsx';

/**
 * باب المحل: حيطة نعناعي فوق، وبلاط تحت، واليافطة، والفورم جوّه مراية
 * (نفس شكل دخول لوحة المحل). العنوان الحقيقي (h1) جوّه المراية.
 */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-center">
        <div className="auth-box">
          <Sign size="lg" aria-hidden="true"><Wordmark height="1.3em" /></Sign>
          <Mirror className="stack lg">
            <div>
              <h1 className="auth-title">{title}</h1>
              {subtitle && <p className="muted">{subtitle}</p>}
            </div>
            {children}
          </Mirror>
          {footer}
        </div>
      </div>
      <div className="tiles" aria-hidden="true" />
    </div>
  );
}
