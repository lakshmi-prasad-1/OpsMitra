import { useDocumentTitle } from '../../lib/hooks.js';
import { PageHeader } from '../../components/ui.jsx';
import Pos from '../../components/Pos.jsx';

export default function NewSale() {
  useDocumentTitle('New sale');
  return (<><PageHeader back="/app/sales" title="New sale" subtitle="Stock is checked and deducted the moment you complete the sale." /><Pos mode="sale" /></>);
}
