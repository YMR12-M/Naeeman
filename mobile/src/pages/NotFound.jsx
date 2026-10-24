import { Link } from 'react-router-dom';
import { Mirror } from '../components/brand/index.jsx';
import { Empty } from '../components/ui/index.js';

export default function NotFound() {
  return (
    <Mirror className="page-card">
      <Empty icon="search" title="الصفحة دي مش موجودة">اتأكد من الرابط، أو ارجع للرئيسية.</Empty>
      <div className="row center"><Link className="btn" to="/">الرئيسية</Link></div>
    </Mirror>
  );
}
