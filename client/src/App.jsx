import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './context/Auth.jsx';
import { ErrorState, PageLoader } from './components/ui.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import Landing from './pages/public/Landing.jsx';
import { Login, Register, ForgotPassword, ResetPassword } from './pages/public/AuthPages.jsx';

const page = loader => lazy(loader);
const Dashboard = page(() => import('./pages/app/Dashboard.jsx'));
const Inventory = page(() => import('./pages/app/Inventory.jsx'));
const ProductDetail = page(() => import('./pages/app/ProductDetail.jsx'));
const Sales = page(() => import('./pages/app/Sales.jsx'));
const NewSale = page(() => import('./pages/app/NewSale.jsx'));
const SaleDetail = page(() => import('./pages/app/SaleDetail.jsx'));
const Orders = page(() => import('./pages/app/Orders.jsx'));
const NewOrder = page(() => import('./pages/app/NewOrder.jsx'));
const OrderDetail = page(() => import('./pages/app/OrderDetail.jsx'));
const Customers = page(() => import('./pages/app/Customers.jsx'));
const CustomerDetail = page(() => import('./pages/app/CustomerDetail.jsx'));
const Suppliers = page(() => import('./pages/app/Suppliers.jsx'));
const SupplierDetail = page(() => import('./pages/app/SupplierDetail.jsx'));
const NewPurchase = page(() => import('./pages/app/NewPurchase.jsx'));
const PurchaseDetail = page(() => import('./pages/app/PurchaseDetail.jsx'));
const Reports = page(() => import('./pages/app/Reports.jsx'));
const Insights = page(() => import('./pages/app/Insights.jsx'));
const Assistant = page(() => import('./pages/app/Assistant.jsx'));
const Settings = page(() => import('./pages/app/Settings.jsx'));
const Help = page(() => import('./pages/app/Help.jsx'));
const NotFound = page(() => import('./pages/app/NotFound.jsx'));

function Splash() {
  return <div className="page-loader" style={{ minHeight: '100vh' }} role="status"><Loader2 className="spin" size={26} /><span>Loading OpsMitra…</span></div>;
}

/** Only renders children when the server confirms a session; otherwise sends the visitor to sign in and back. */
function RequireAuth({ children }) {
  const { user, loading, error, retry } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (error && !user) return <div style={{ padding: 40 }}><ErrorState title="Can't reach OpsMitra" error={error} onRetry={retry} /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace state={{ expired: true }} />;
  return children;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  const next = new URLSearchParams(useLocation().search).get('next');
  if (loading) return <Splash />;
  if (user) return <Navigate to={next && next.startsWith('/app') ? next : '/app'} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Lazy><Dashboard /></Lazy>} />
        <Route path="inventory" element={<Lazy><Inventory /></Lazy>} />
        <Route path="inventory/:id" element={<Lazy><ProductDetail /></Lazy>} />
        <Route path="sales" element={<Lazy><Sales /></Lazy>} />
        <Route path="sales/new" element={<Lazy><NewSale /></Lazy>} />
        <Route path="sales/:id" element={<Lazy><SaleDetail /></Lazy>} />
        <Route path="orders" element={<Lazy><Orders /></Lazy>} />
        <Route path="orders/new" element={<Lazy><NewOrder /></Lazy>} />
        <Route path="orders/:id" element={<Lazy><OrderDetail /></Lazy>} />
        <Route path="customers" element={<Lazy><Customers /></Lazy>} />
        <Route path="customers/:id" element={<Lazy><CustomerDetail /></Lazy>} />
        <Route path="suppliers" element={<Lazy><Suppliers /></Lazy>} />
        <Route path="suppliers/:id" element={<Lazy><SupplierDetail /></Lazy>} />
        <Route path="purchases" element={<Navigate to="/app/suppliers?tab=purchases" replace />} />
        <Route path="purchases/new" element={<Lazy><NewPurchase /></Lazy>} />
        <Route path="purchases/:id" element={<Lazy><PurchaseDetail /></Lazy>} />
        <Route path="reports" element={<Lazy><Reports /></Lazy>} />
        <Route path="insights" element={<Lazy><Insights /></Lazy>} />
        <Route path="assistant" element={<Lazy><Assistant /></Lazy>} />
        <Route path="settings/*" element={<Lazy><Settings /></Lazy>} />
        <Route path="help" element={<Lazy><Help /></Lazy>} />
        <Route path="*" element={<Lazy><NotFound /></Lazy>} />
      </Route>
      <Route path="*" element={<Lazy><NotFound standalone /></Lazy>} />
    </Routes>
  );
}

const Lazy = ({ children }) => <Suspense fallback={<PageLoader />}>{children}</Suspense>;
