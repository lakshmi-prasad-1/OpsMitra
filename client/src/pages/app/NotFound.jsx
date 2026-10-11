import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Button, EmptyState } from '../../components/ui.jsx';

export default function NotFound({ standalone }) {
  useDocumentTitle('Page not found');
  const body = <EmptyState icon={Compass} title="We couldn't find that page" text="The link may be old or mistyped." action={<Button as={Link} to={standalone ? '/' : '/app'}>{standalone ? 'Go to the home page' : 'Back to the dashboard'}</Button>} />;
  return standalone ? <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>{body}</div> : <div className="panel">{body}</div>;
}
