import { useDocumentTitle } from '../../lib/hooks.js';
import { PageHeader } from '../../components/ui.jsx';
import Pos from '../../components/Pos.jsx';

export default function NewOrder() {
  useDocumentTitle('New order');
  return (<><PageHeader back="/app/orders" title="New order" subtitle="Track a customer order from pending to delivered." /><Pos mode="order" /></>);
}
