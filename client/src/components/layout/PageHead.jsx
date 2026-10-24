import { Sign } from '../brand/index.jsx';

/** رأس الصفحة: اليافطة بالعنوان، وجنبها الأدوات */
export default function PageHead({ title, children, note }) {
  return (
    <div className="page-head">
      <div className="row wrap">
        <Sign as="h1">{title}</Sign>
        {note}
      </div>
      {children && <div className="tools">{children}</div>}
    </div>
  );
}
