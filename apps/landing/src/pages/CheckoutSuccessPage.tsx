import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DASHBOARD_URL, apiFetch, readErrorMessage } from '../lib/api';

type FinalizeResponse = {
  success: boolean;
  alreadyProcessed?: boolean;
  dashboardUrl?: string;
};

export default function CheckoutSuccessPage() {
  const [searchParams] = useSearchParams();
  const flowToken = useMemo(() => searchParams.get('flowToken')?.trim() || '', [searchParams]);
  const sessionId = useMemo(
    () => searchParams.get('session_id')?.trim() || searchParams.get('sessionId')?.trim() || '',
    [searchParams]
  );
  const attemptedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [dashboardUrl, setDashboardUrl] = useState(`${DASHBOARD_URL}/login`);

  const finalizeCheckout = async () => {
    if (!flowToken || !sessionId) {
      setError('Faltan parámetros de checkout para finalizar el pago.');
      setIsLoading(false);
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await apiFetch('/api/v1/billing/checkout/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowToken,
          sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'No se pudo confirmar el pago'));
      }

      const payload = (await response.json()) as FinalizeResponse;
      setIsSuccess(Boolean(payload.success || payload.alreadyProcessed));
      if (payload.dashboardUrl) {
        setDashboardUrl(payload.dashboardUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo confirmar el pago');
    } finally {
      setIsSubmitting(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    void finalizeCheckout();
  }, []);

  return (
    <div className="min-h-screen bg-[#08080d] text-white">
      {/* Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-[#4D7CFF]/[0.06] rounded-full blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-600/[0.05] rounded-full blur-[120px]" />
        {isSuccess && (
          <div className="absolute top-[20%] left-[40%] w-[400px] h-[400px] bg-emerald-500/[0.04] rounded-full blur-[120px]" />
        )}
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

      {/* Steps indicator — all completed */}
      <div className="max-w-5xl mx-auto px-6 pt-8 pb-2">
        <div className="flex items-center gap-3">
          {['Plan', 'Cuenta', 'Pago'].map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <div className="flex items-center gap-2 opacity-100">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  isSuccess
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : i < 2
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-[#4D7CFF] text-white'
                }`}>
                  {isSuccess || i < 2 ? (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span className={`text-sm font-medium ${
                  isSuccess || i < 2 ? 'text-emerald-400' : 'text-white'
                }`}>{step}</span>
              </div>
              {i < 2 && (
                <div className="w-12 h-px bg-emerald-500/30" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-6 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5 ${
            isSuccess
              ? 'bg-emerald-500/10 border border-emerald-500/20'
              : isLoading
              ? 'bg-[#4D7CFF]/10 border border-[#4D7CFF]/20'
              : 'bg-red-500/10 border border-red-500/20'
          }`}>
            {isSuccess ? (
              <svg className="w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            ) : isLoading ? (
              <div className="w-8 h-8 border-2 border-white/10 border-t-[#4D7CFF] rounded-full animate-spin" />
            ) : (
              <svg className="w-8 h-8 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isSuccess ? 'Pago confirmado' : isLoading ? 'Confirmando pago...' : 'Error en el pago'}
          </h1>
          <p className="text-sm text-white/40 mt-2 max-w-sm mx-auto">
            {isSuccess
              ? 'Tu suscripción quedó activa. Ya podés ingresar al dashboard y empezar a usar Nexova.'
              : isLoading
              ? 'Estamos validando la sesión de Stripe. Solo tomará un momento.'
              : 'Hubo un problema al confirmar tu pago. Podés reintentar.'}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md overflow-hidden">
          <div className="px-6 py-6 space-y-5">
            {/* Loading */}
            {isLoading && (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="relative">
                  <div className="w-10 h-10 border-2 border-white/[0.06] rounded-full" />
                  <div className="absolute inset-0 w-10 h-10 border-2 border-transparent border-t-[#4D7CFF] rounded-full animate-spin" />
                </div>
                <p className="text-xs text-white/30">Validando con Stripe...</p>
              </div>
            )}

            {/* Success confetti-like celebration */}
            {isSuccess && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-300">Suscripción activada</p>
                    <p className="text-xs text-emerald-400/50 mt-0.5">Tu workspace está listo para usar</p>
                  </div>
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

            {/* Actions */}
            <div className="space-y-3">
              {isSuccess ? (
                <a
                  href={dashboardUrl}
                  className="group relative block w-full text-center rounded-xl bg-[#4D7CFF] hover:bg-[#3D6BEE] px-4 py-3.5 font-medium text-sm transition-all duration-300 shadow-lg shadow-[#4D7CFF]/25 hover:shadow-xl hover:shadow-[#4D7CFF]/40 overflow-hidden"
                >
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                  <span className="relative flex items-center justify-center gap-2">
                    Ir al dashboard
                    <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </a>
              ) : !isLoading ? (
                <>
                  <button
                    type="button"
                    onClick={() => void finalizeCheckout()}
                    disabled={isSubmitting}
                    className="group relative w-full rounded-xl bg-[#4D7CFF] hover:bg-[#3D6BEE] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3.5 font-medium text-sm transition-all duration-300 shadow-lg shadow-[#4D7CFF]/25 hover:shadow-xl hover:shadow-[#4D7CFF]/40 overflow-hidden"
                  >
                    <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                    <span className="relative flex items-center justify-center gap-2">
                      {isSubmitting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Reintentando...
                        </>
                      ) : (
                        'Reintentar validación'
                      )}
                    </span>
                  </button>
                  <a
                    href={dashboardUrl}
                    className="block w-full text-center rounded-xl border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.18] px-4 py-3.5 font-medium text-sm text-white/70 hover:text-white transition-all duration-200"
                  >
                    Ir al dashboard de todas formas
                  </a>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
