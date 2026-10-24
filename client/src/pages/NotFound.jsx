import { Link } from 'react-router-dom';
import { MarkerNote, Mirror } from '../components/brand/index.jsx';

export default function NotFound() {
  return (
    <Mirror arch className="not-found">
      <MarkerNote>الصفحة دي مش موجودة</MarkerNote>
      <Link to="/">ارجع للطابور</Link>
    </Mirror>
  );
}
