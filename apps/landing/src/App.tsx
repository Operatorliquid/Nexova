import { Navigate, Route, Routes } from 'react-router-dom';

import CartPage from './pages/CartPage';
import CheckoutContinuePage from './pages/CheckoutContinuePage';
import CheckoutSuccessPage from './pages/CheckoutSuccessPage';
import DemoPage from './pages/DemoPage';
import IndexPage from './pages/IndexPage';
import RegisterPage from './pages/RegisterPage';
import VerifyEmailPage from './pages/VerifyEmailPage';

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<IndexPage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="/demo/" element={<DemoPage />} />
      <Route path="/demo/index.html" element={<DemoPage />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/cart/" element={<CartPage />} />
      <Route path="/cart/index.html" element={<CartPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/" element={<RegisterPage />} />
      <Route path="/register/index.html" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/verify-email/" element={<VerifyEmailPage />} />
      <Route path="/verify-email/index.html" element={<VerifyEmailPage />} />
      <Route path="/checkout/continue" element={<CheckoutContinuePage />} />
      <Route path="/checkout/continue/" element={<CheckoutContinuePage />} />
      <Route path="/checkout/continue/index.html" element={<CheckoutContinuePage />} />
      <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
      <Route path="/checkout/success/" element={<CheckoutSuccessPage />} />
      <Route path="/checkout/success/index.html" element={<CheckoutSuccessPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
