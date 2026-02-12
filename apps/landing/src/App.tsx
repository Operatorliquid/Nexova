import { Navigate, Route, Routes } from 'react-router-dom';
import IndexPage from './pages/IndexPage';
import CartPage from './pages/CartPage';
import RegisterPage from './pages/RegisterPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import CheckoutContinuePage from './pages/CheckoutContinuePage';
import CheckoutSuccessPage from './pages/CheckoutSuccessPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<IndexPage />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/checkout/continue" element={<CheckoutContinuePage />} />
      <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
