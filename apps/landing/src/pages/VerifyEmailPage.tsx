import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, readErrorMessage } from '../lib/api';

type VerifyResponse = {
  success: boolean;
  next?: string;
};

type IntentStatusResponse = {
  intent?: {
    status?: string;
    isVerified?: boolean;
  };
};

const isVerifiedStatus = (status?: string) =>
  status === 'verified' || status === 'checkout_created' || status === 'completed';

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const flowToken = useMemo(() => searchParams.get('flowToken')?.trim() || '', [searchParams]);
  const email = useMemo(() => searchParams.get('email')?.trim() || '', [searchParams]);
  const token = useMemo(() => searchParams.get('token')?.trim() || '', [searchParams]);
  const hasToken = token.length > 0;
  const syncKey = useMemo(
    () => (flowToken ? `nexova:billing:verified:${flowToken}` : ''),
    [flowToken]
  );

  const [isVerifying, setIsVerifying] = useState(hasToken);
  const [isPolling, setIsPolling] = useState(!hasToken);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState(
    hasToken
      ? 'Validando enlace de verificación...'
      : 'Verificá tu cuenta para continuar. Esta pantalla se actualizará automáticamente.'
  );
  const [nextUrl, setNextUrl] = useState(
    flowToken ? `/checkout/continue?flowToken=${encodeURIComponent(flowToken)}` : '/cart'
  );

  const autoAttemptedRef = useRef(false);
  const navigatingRef = useRef(false);

  const notifyVerified = () => {
    if (!flowToken) return;
    try {
      localStorage.setItem(syncKey, String(Date.now()));
    } catch {
      // noop
    }
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'nexova.billing.emailVerified', flowToken }, '*');
      }
    } catch {
      // noop
    }
  };

  const goToCheckout = () => {
    if (!flowToken || navigatingRef.current) return;
    navigatingRef.current = true;
    navigate(`/checkout/continue?flowToken=${encodeURIComponent(flowToken)}`, { replace: true });
  };

  const verifyToken = async (tokenToVerify: string) => {
    if (!flowToken) {
      setIsVerifying(false);
      setError('Falta flowToken para verificar la cuenta.');
      return;
    }

    setIsVerifying(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/billing/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: tokenToVerify,
          flowToken,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'No se pudo verificar el email.'));
      }

      const payload = (await response.json()) as VerifyResponse;
      setSuccess(true);
      setStatusMessage('Verificación exitosa. Puedes cerrar esta ventana.');
      if (payload.next) {
        setNextUrl(payload.next);
      }
      notifyVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el email.');
      setStatusMessage('No pudimos verificar el enlace. Reintentá desde el botón.');
    } finally {
      setIsVerifying(false);
      setIsPolling(false);
    }
  };

  const pollIntent = async () => {
    if (!flowToken || hasToken || navigatingRef.current) return;
    try {
      const response = await apiFetch(`/api/v1/billing/intents/${encodeURIComponent(flowToken)}`);
      if (!response.ok) return;

      const payload = (await response.json()) as IntentStatusResponse;
      const status = payload.intent?.status;
      if (payload.intent?.isVerified || isVerifiedStatus(status)) {
        setSuccess(true);
        setError('');
        setStatusMessage('Cuenta verificada. Redirigiendo al checkout...');
        setIsPolling(false);
        goToCheckout();
      }
    } catch {
      // silencio para no ensuciar UX durante polling
    }
  };

  useEffect(() => {
    if (!hasToken || autoAttemptedRef.current) return;
    autoAttemptedRef.current = true;
    void verifyToken(token);
  }, [hasToken, token]);

  useEffect(() => {
    if (hasToken || !flowToken) return;
    void pollIntent();
    const interval = window.setInterval(() => {
      void pollIntent();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [hasToken, flowToken]);

  useEffect(() => {
    if (!syncKey || hasToken) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== syncKey || !event.newValue) return;
      setSuccess(true);
      setError('');
      setStatusMessage('Cuenta verificada. Redirigiendo al checkout...');
      setIsPolling(false);
      goToCheckout();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncKey, hasToken, flowToken]);

  return (
    <div className="min-h-screen bg-[#08080d] text-white">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-[#4D7CFF]/[0.06] rounded-full blur-[140px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-600/[0.05] rounded-full blur-[120px]" />
      </div>

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
          <span className="text-xs text-white/30">Verificación de cuenta</span>
        </div>
      </nav>

      <div className="max-w-lg mx-auto px-6 py-12">
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
            {success ? 'Cuenta verificada' : 'Verificá tu cuenta para continuar'}
          </h1>
          <p className="text-sm text-white/40 mt-2">{statusMessage}</p>
          {email && !success && (
            <p className="text-xs text-white/30 mt-2">Email: {email}</p>
          )}
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md overflow-hidden">
          <div className="px-6 py-6 space-y-4">
            {(isVerifying || isPolling) && (
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="w-9 h-9 border-2 border-white/10 border-t-[#4D7CFF] rounded-full animate-spin" />
                <p className="text-xs text-white/35">
                  {isVerifying ? 'Verificando enlace...' : 'Esperando confirmación del email...'}
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3">
                <p className="text-sm text-red-300/80">{error}</p>
              </div>
            )}

            {hasToken && !success && !isVerifying && (
              <button
                type="button"
                onClick={() => verifyToken(token)}
                className="w-full rounded-xl border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] px-4 py-3.5 font-medium text-sm transition-all duration-200 text-white/75"
              >
                Reintentar verificación
              </button>
            )}

            {hasToken && success && (
              <a
                href={nextUrl}
                className="group relative block w-full text-center rounded-xl bg-[#4D7CFF] hover:bg-[#3D6BEE] px-4 py-3.5 font-medium text-sm transition-all duration-300 shadow-lg shadow-[#4D7CFF]/25"
              >
                Continuar al checkout
              </a>
            )}

            {!hasToken && !success && (
              <p className="text-center text-[11px] text-white/25 leading-relaxed">
                Abrí el email y tocá el enlace de verificación. Al confirmar, esta pantalla continuará automáticamente.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
