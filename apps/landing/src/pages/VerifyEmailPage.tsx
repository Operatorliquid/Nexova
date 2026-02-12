import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, readErrorMessage } from '../lib/api';

type VerifyResponse = {
  success: boolean;
  next?: string;
};

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const flowToken = useMemo(() => searchParams.get('flowToken')?.trim() || '', [searchParams]);
  const email = useMemo(() => searchParams.get('email')?.trim() || '', [searchParams]);
  const token = useMemo(() => searchParams.get('token')?.trim() || '', [searchParams]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  const [nextUrl, setNextUrl] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const autoAttemptedRef = useRef(false);

  const verifyToken = async (tokenToVerify: string) => {
    setIsVerifying(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/billing/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: tokenToVerify,
          flowToken: flowToken || undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'No se pudo verificar el email'));
      }
      const payload = (await response.json()) as VerifyResponse;
      setSuccess(true);
      if (payload.next) {
        setNextUrl(payload.next);
      } else if (flowToken) {
        setNextUrl(`/checkout/continue?flowToken=${encodeURIComponent(flowToken)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el email');
    } finally {
      setIsVerifying(false);
    }
  };

  const checkSessionAndContinue = async () => {
    if (!flowToken) {
      setError('Falta el flowToken para continuar el checkout.');
      return;
    }
    setIsCheckingSession(true);
    setError('');
    try {
      const meResponse = await apiFetch('/api/v1/auth/me');
      if (!meResponse.ok) {
        throw new Error('Todavía no hay sesión activa. Verificá el email primero.');
      }
      navigate(`/checkout/continue?flowToken=${encodeURIComponent(flowToken)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo validar la sesión');
    } finally {
      setIsCheckingSession(false);
    }
  };

  useEffect(() => {
    if (!token || autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;
    verifyToken(token);
  }, [token]);

  const continueHref = nextUrl || (flowToken ? `/checkout/continue?flowToken=${encodeURIComponent(flowToken)}` : '/cart');

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
            to={flowToken ? `/register?flowToken=${encodeURIComponent(flowToken)}` : '/cart'}
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Volver
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
          <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-5 ${
            success
              ? 'bg-emerald-500/10 border border-emerald-500/20'
              : 'bg-[#4D7CFF]/10 border border-[#4D7CFF]/20'
          }`}>
            {success ? (
              <svg className="w-7 h-7 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            ) : (
              <svg className="w-7 h-7 text-[#4D7CFF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {success ? 'Email verificado' : 'Verificá tu email'}
          </h1>
          <p className="text-sm text-white/40 mt-2 max-w-sm mx-auto">
            {success
              ? 'Tu cuenta fue verificada correctamente. Ya podés continuar al pago.'
              : 'Te enviamos un enlace de verificación para continuar el checkout.'}
          </p>
          {email && !success && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-1.5">
              <svg className="w-3.5 h-3.5 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span className="text-xs text-white/60">{email}</span>
            </div>
          )}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md overflow-hidden">
          <div className="px-6 py-6 space-y-4">
            {/* Success banner */}
            {success && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <p className="text-sm text-emerald-300/80">Email verificado correctamente</p>
                </div>
              </div>
            )}

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

            {/* Verifying spinner */}
            {isVerifying && (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-8 h-8 border-2 border-white/10 border-t-[#4D7CFF] rounded-full animate-spin" />
                <p className="text-sm text-white/40">Verificando...</p>
              </div>
            )}

            {/* Actions */}
            <div className="space-y-3">
              {token && !isVerifying ? (
                <button
                  type="button"
                  onClick={() => verifyToken(token)}
                  disabled={isVerifying}
                  className="w-full rounded-xl border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3.5 font-medium text-sm transition-all duration-200 text-white/70 hover:text-white hover:border-white/[0.18]"
                >
                  Reintentar verificación del enlace
                </button>
              ) : !token && !isVerifying ? (
                <button
                  type="button"
                  onClick={checkSessionAndContinue}
                  disabled={isCheckingSession}
                  className="w-full rounded-xl border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3.5 font-medium text-sm transition-all duration-200 text-white/70 hover:text-white hover:border-white/[0.18]"
                >
                  {isCheckingSession ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Validando sesión...
                    </span>
                  ) : (
                    'Ya verifiqué mi email'
                  )}
                </button>
              ) : null}

              <a
                href={continueHref}
                className="group relative block w-full text-center rounded-xl bg-[#4D7CFF] hover:bg-[#3D6BEE] px-4 py-3.5 font-medium text-sm transition-all duration-300 shadow-lg shadow-[#4D7CFF]/25 hover:shadow-xl hover:shadow-[#4D7CFF]/40 overflow-hidden"
              >
                {/* Shimmer */}
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                <span className="relative flex items-center justify-center gap-2">
                  Continuar al checkout
                  <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </span>
              </a>
            </div>

            {/* Email hint */}
            {!success && !isVerifying && (
              <div className="pt-2">
                <p className="text-center text-[11px] text-white/20 leading-relaxed">
                  Si no encontrás el email, revisá la carpeta de spam o correo no deseado.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
