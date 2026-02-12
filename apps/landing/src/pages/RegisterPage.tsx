import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { API_URL, apiFetch, readErrorMessage } from '../lib/api';

type RegisterResponse = {
  success: boolean;
  flowToken: string;
  email: string;
  requiresEmailVerification: boolean;
  message?: string;
  debugVerificationUrl?: string;
};

const extractTokenFromDebugUrl = (rawUrl?: string): string | null => {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    return parsed.searchParams.get('token');
  } catch {
    return null;
  }
};

const getPasswordStrength = (pw: string): { level: number; label: string; color: string } => {
  if (!pw) return { level: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { level: 1, label: 'Muy débil', color: 'bg-red-500' };
  if (score === 2) return { level: 2, label: 'Débil', color: 'bg-orange-500' };
  if (score === 3) return { level: 3, label: 'Aceptable', color: 'bg-amber-500' };
  if (score === 4) return { level: 4, label: 'Fuerte', color: 'bg-emerald-500' };
  return { level: 5, label: 'Muy fuerte', color: 'bg-emerald-400' };
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const flowToken = useMemo(() => searchParams.get('flowToken')?.trim() || '', [searchParams]);

  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState(searchParams.get('email')?.trim() || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const passwordStrength = getPasswordStrength(password);
  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flowToken) {
      setError('Falta el flowToken de checkout. Volvé al carrito.');
      return;
    }
    if (!firstName.trim()) {
      setError('Ingresá tu nombre.');
      return;
    }
    if (password.length < 8) {
      setError('La clave debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('La confirmación de clave no coincide.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await apiFetch('/api/v1/billing/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowToken,
          email: email.trim().toLowerCase(),
          password,
          firstName: firstName.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'No se pudo completar el registro'));
      }

      const payload = (await response.json()) as RegisterResponse;
      const params = new URLSearchParams({
        flowToken,
        email: payload.email || email.trim().toLowerCase(),
      });

      const debugToken = extractTokenFromDebugUrl(payload.debugVerificationUrl);
      if (debugToken) {
        params.set('token', debugToken);
      }

      navigate(`/verify-email?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar el registro');
    } finally {
      setIsSubmitting(false);
    }
  };

  const continueWithGoogle = () => {
    if (!flowToken) {
      setError('Falta el flowToken de checkout. Volvé al carrito.');
      return;
    }
    const base = API_URL || '';
    window.location.href = `${base}/api/v1/billing/auth/google/start?flowToken=${encodeURIComponent(flowToken)}`;
  };

  return (
    <div className="min-h-screen bg-[#08080d] text-white">
      {/* Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-[#4D7CFF]/[0.06] rounded-full blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-600/[0.05] rounded-full blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      {/* Navbar */}
      <nav className="border-b border-white/[0.06] bg-[#08080d]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link
            to={flowToken ? `/cart?flowToken=${encodeURIComponent(flowToken)}` : '/cart'}
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Volver al carrito
          </Link>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span className="text-xs text-white/30">Pago seguro con Stripe</span>
          </div>
        </div>
      </nav>

      {/* Steps indicator */}
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-2">
        <div className="flex items-center gap-3">
          {['Plan', 'Cuenta', 'Pago'].map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <div className={`flex items-center gap-2 ${i <= 1 ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  i < 1
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : i === 1
                    ? 'bg-[#4D7CFF] text-white'
                    : 'border border-white/20 text-white/40'
                }`}>
                  {i < 1 ? (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span className={`text-sm font-medium ${
                  i < 1 ? 'text-emerald-400' : i === 1 ? 'text-white' : 'text-white/40'
                }`}>{step}</span>
              </div>
              {i < 2 && (
                <div className={`w-12 h-px ${i < 1 ? 'bg-emerald-500/30' : 'bg-white/10'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-6 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#4D7CFF]/10 border border-[#4D7CFF]/20 mb-5">
            <svg className="w-7 h-7 text-[#4D7CFF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Creá tu cuenta</h1>
          <p className="text-sm text-white/40 mt-2">
            Registrate para completar la suscripción. Solo toma un minuto.
          </p>
        </div>

        {/* No flow token warning */}
        {!flowToken && (
          <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p className="text-sm text-amber-300/80">Falta el token del checkout. Volvé al carrito y seleccioná un plan.</p>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md overflow-hidden">
          {/* Google auth */}
          <div className="px-6 pt-6 pb-0">
            <button
              type="button"
              onClick={continueWithGoogle}
              disabled={!flowToken}
              className="group relative w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3.5 font-medium text-sm transition-all duration-200 hover:border-white/[0.18]"
            >
              {/* Google icon */}
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span className="text-white/80">Continuar con Google</span>
            </button>
          </div>

          {/* Divider */}
          <div className="px-6 py-5">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/[0.06]" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-[#0d0d14] px-3 text-white/25">o continuá con email</span>
              </div>
            </div>
          </div>

          {/* Form */}
          <form className="px-6 pb-6 space-y-4" onSubmit={onSubmit}>
            {/* Name */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-white/50 uppercase tracking-wider">
                Nombre
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-all duration-200 focus:border-[#4D7CFF]/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(77,124,255,0.08)]"
                  placeholder="Tu nombre"
                  autoComplete="given-name"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-white/50 uppercase tracking-wider">
                Email
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-all duration-200 focus:border-[#4D7CFF]/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(77,124,255,0.08)]"
                  placeholder="nombre@empresa.com"
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-white/50 uppercase tracking-wider">
                Clave
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-all duration-200 focus:border-[#4D7CFF]/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(77,124,255,0.08)]"
                  placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password"
                />
              </div>

              {/* Password strength */}
              {password.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 flex gap-1">
                    {[1, 2, 3, 4, 5].map((segment) => (
                      <div
                        key={segment}
                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                          segment <= passwordStrength.level
                            ? passwordStrength.color
                            : 'bg-white/[0.06]'
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`text-[10px] font-medium ${
                    passwordStrength.level <= 1 ? 'text-red-400' :
                    passwordStrength.level === 2 ? 'text-orange-400' :
                    passwordStrength.level === 3 ? 'text-amber-400' :
                    'text-emerald-400'
                  }`}>
                    {passwordStrength.label}
                  </span>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-white/50 uppercase tracking-wider">
                Confirmar clave
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={`w-full rounded-xl border bg-white/[0.03] pl-10 pr-10 py-3 text-sm text-white placeholder-white/20 outline-none transition-all duration-200 focus:bg-white/[0.05] ${
                    !passwordsMatch
                      ? 'border-red-500/30 focus:border-red-500/50 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.08)]'
                      : confirmPassword.length > 0
                      ? 'border-emerald-500/30 focus:border-emerald-500/50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]'
                      : 'border-white/[0.08] focus:border-[#4D7CFF]/50 focus:shadow-[0_0_0_3px_rgba(77,124,255,0.08)]'
                  }`}
                  placeholder="Repetí la clave"
                  autoComplete="new-password"
                />
                {/* Match indicator */}
                {confirmPassword.length > 0 && (
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    {passwordsMatch ? (
                      <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </div>
                )}
              </div>
              {!passwordsMatch && (
                <p className="text-[11px] text-red-400/80">Las claves no coinciden</p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <p className="text-sm text-red-300/80">{error}</p>
                </div>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting || !flowToken}
              className="group relative w-full rounded-xl bg-[#4D7CFF] hover:bg-[#3D6BEE] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3.5 font-medium text-sm transition-all duration-300 shadow-lg shadow-[#4D7CFF]/25 hover:shadow-xl hover:shadow-[#4D7CFF]/40 overflow-hidden"
            >
              {/* Shimmer */}
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              <span className="relative flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creando cuenta...
                  </>
                ) : (
                  <>
                    Crear cuenta y continuar
                    <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </span>
            </button>
          </form>

          {/* Footer */}
          <div className="px-6 pb-5 pt-1">
            <p className="text-center text-[11px] text-white/20 leading-relaxed">
              Al registrarte aceptás nuestros{' '}
              <a href="#" className="text-white/35 hover:text-white/50 underline underline-offset-2 transition-colors">
                Términos de servicio
              </a>{' '}
              y{' '}
              <a href="#" className="text-white/35 hover:text-white/50 underline underline-offset-2 transition-colors">
                Política de privacidad
              </a>
            </p>
          </div>
        </div>

        {/* Trust badges */}
        <div className="flex items-center justify-center gap-5 mt-6">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span className="text-[11px] text-white/20">SSL seguro</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-[11px] text-white/20">Datos encriptados</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-[11px] text-white/20">14 días gratis</span>
          </div>
        </div>
      </div>
    </div>
  );
}
