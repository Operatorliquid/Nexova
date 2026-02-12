import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BILLING_MONTH_OPTIONS } from '@nexova/shared';
import { apiFetch, readErrorMessage } from '../lib/api';

type CatalogPlan = {
  plan: 'basic' | 'standard' | 'pro';
  name: string;
  description: string;
  currency: 'USD';
  monthlyAmountCents: number;
};

type BillingIntent = {
  flowToken: string;
  plan: 'basic' | 'standard' | 'pro';
  months: number;
  status: string;
};

const PLAN_META: Record<string, { icon: string; color: string; colorBg: string; colorBorder: string; colorGlow: string; badge?: string }> = {
  basic: {
    icon: '🚀',
    color: 'text-sky-400',
    colorBg: 'bg-sky-500/10',
    colorBorder: 'border-sky-500/30',
    colorGlow: 'shadow-sky-500/20',
  },
  standard: {
    icon: '⚡',
    color: 'text-[#4D7CFF]',
    colorBg: 'bg-[#4D7CFF]/10',
    colorBorder: 'border-[#4D7CFF]/30',
    colorGlow: 'shadow-[#4D7CFF]/20',
    badge: 'Popular',
  },
  pro: {
    icon: '👑',
    color: 'text-purple-400',
    colorBg: 'bg-purple-500/10',
    colorBorder: 'border-purple-500/30',
    colorGlow: 'shadow-purple-500/20',
  },
};

const MONTH_LABELS: Record<number, { label: string; save?: string }> = {
  1: { label: '1 mes' },
  12: { label: '12 meses', save: 'Ahorrá 2 meses' },
  24: { label: '24 meses', save: 'Ahorrá 5 meses' },
  48: { label: '48 meses', save: 'Ahorrá 12 meses' },
};

export default function CartPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryFlowToken = searchParams.get('flowToken') || '';
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string>(searchParams.get('plan') || 'standard');
  const [months, setMonths] = useState<number>(
    Number.parseInt(searchParams.get('months') || '1', 10) || 1
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadCatalog = async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await apiFetch('/api/v1/billing/catalog');
        if (!res.ok) {
          throw new Error(await readErrorMessage(res, 'No se pudo cargar el catálogo de planes'));
        }
        const data = (await res.json()) as { plans: CatalogPlan[] };
        setPlans(data.plans || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo de planes');
      } finally {
        setIsLoading(false);
      }
    };
    loadCatalog();
  }, []);

  useEffect(() => {
    const safeMonths = BILLING_MONTH_OPTIONS.includes(months as (typeof BILLING_MONTH_OPTIONS)[number])
      ? months
      : 1;
    if (safeMonths !== months) {
      setMonths(safeMonths);
    }
  }, [months]);

  useEffect(() => {
    const loadExistingIntent = async () => {
      if (!queryFlowToken) return;
      try {
        const res = await apiFetch(`/api/v1/billing/intents/${encodeURIComponent(queryFlowToken)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { intent?: BillingIntent };
        if (!data.intent) return;
        setSelectedPlan(data.intent.plan);
        if (BILLING_MONTH_OPTIONS.includes(data.intent.months as (typeof BILLING_MONTH_OPTIONS)[number])) {
          setMonths(data.intent.months);
        }
      } catch {
        // noop
      }
    };
    loadExistingIntent();
  }, [queryFlowToken]);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.plan === selectedPlan) || null,
    [plans, selectedPlan]
  );

  const totalAmountCents = activePlan ? activePlan.monthlyAmountCents * months : 0;
  const currency = activePlan?.currency || 'USD';

  const formatMoney = (amountCents: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amountCents / 100);

  const continueFlow = async () => {
    if (!activePlan) return;
    setIsSubmitting(true);
    setError('');
    try {
      const createRes = await apiFetch('/api/v1/billing/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: activePlan.plan,
          months,
        }),
      });
      if (!createRes.ok) {
        throw new Error(await readErrorMessage(createRes, 'No se pudo iniciar el checkout'));
      }
      const created = (await createRes.json()) as { flowToken: string };
      const nextFlowToken = created.flowToken;

      const meRes = await apiFetch('/api/v1/auth/me');
      if (meRes.ok) {
        navigate(`/checkout/continue?flowToken=${encodeURIComponent(nextFlowToken)}`);
      } else {
        navigate(`/register?flowToken=${encodeURIComponent(nextFlowToken)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo continuar el checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  const meta = PLAN_META[selectedPlan] || PLAN_META.standard;

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
          <Link to="/" className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors">
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
              <div className={`flex items-center gap-2 ${i === 0 ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  i === 0
                    ? 'bg-[#4D7CFF] text-white'
                    : 'border border-white/20 text-white/40'
                }`}>
                  {i + 1}
                </div>
                <span className={`text-sm font-medium ${i === 0 ? 'text-white' : 'text-white/40'}`}>{step}</span>
              </div>
              {i < 2 && (
                <div className="w-12 h-px bg-white/10" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-[1fr,380px] gap-8">

          {/* ── LEFT: Plan selection ── */}
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Elegí tu plan</h1>
              <p className="text-sm text-white/40 mt-1">
                Todos incluyen 14 días de prueba gratis. Cancelá cuando quieras.
              </p>
            </div>

            {/* Plan cards */}
            {isLoading ? (
              <div className="h-48 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/10 border-t-[#4D7CFF] rounded-full animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {plans.map((plan) => {
                  const selected = selectedPlan === plan.plan;
                  const pm = PLAN_META[plan.plan] || PLAN_META.standard;
                  return (
                    <button
                      key={plan.plan}
                      type="button"
                      onClick={() => setSelectedPlan(plan.plan)}
                      className={`group relative rounded-2xl border p-5 text-left transition-all duration-300 hover:-translate-y-0.5 ${
                        selected
                          ? `${pm.colorBorder} ${pm.colorBg} shadow-lg ${pm.colorGlow}`
                          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.03]'
                      }`}
                    >
                      {/* Popular badge */}
                      {pm.badge && (
                        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-[#4D7CFF] text-[10px] font-semibold text-white shadow-lg shadow-[#4D7CFF]/30">
                          {pm.badge}
                        </div>
                      )}

                      {/* Radio indicator */}
                      <div className="flex items-start justify-between mb-3">
                        <span className="text-2xl">{pm.icon}</span>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          selected ? `${pm.colorBorder} ${pm.colorBg}` : 'border-white/15'
                        }`}>
                          {selected && (
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              plan.plan === 'basic' ? 'bg-sky-400' :
                              plan.plan === 'standard' ? 'bg-[#4D7CFF]' : 'bg-purple-400'
                            }`} />
                          )}
                        </div>
                      </div>

                      <p className={`text-sm font-semibold ${selected ? pm.color : 'text-white/70'} transition-colors`}>
                        {plan.name}
                      </p>

                      <div className="flex items-baseline gap-1 mt-1.5 mb-2">
                        <span className="text-2xl font-bold text-white">{formatMoney(plan.monthlyAmountCents)}</span>
                        <span className="text-xs text-white/30">/mes</span>
                      </div>

                      <p className="text-xs text-white/35 leading-relaxed">{plan.description}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Billing period */}
            <div>
              <h2 className="text-sm font-semibold text-white/70 mb-3">Periodo de facturación</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BILLING_MONTH_OPTIONS.map((option) => {
                  const active = months === option;
                  const info = MONTH_LABELS[option] || { label: `${option} meses` };
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setMonths(option)}
                      className={`relative rounded-xl border p-3 text-left transition-all duration-200 ${
                        active
                          ? 'border-[#4D7CFF]/30 bg-[#4D7CFF]/[0.06] shadow-md shadow-[#4D7CFF]/10'
                          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                      }`}
                    >
                      <p className={`text-sm font-medium ${active ? 'text-white' : 'text-white/60'}`}>
                        {info.label}
                      </p>
                      {info.save && (
                        <p className="text-[10px] text-emerald-400/80 font-medium mt-0.5">{info.save}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── RIGHT: Order summary ── */}
          <div className="lg:sticky lg:top-24 h-fit">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md overflow-hidden">
              {/* Summary header */}
              <div className="px-6 py-5 border-b border-white/[0.06]">
                <h2 className="text-base font-semibold">Resumen del pedido</h2>
              </div>

              {/* Selected plan */}
              <div className="px-6 py-5 space-y-4">
                {activePlan ? (
                  <div className={`flex items-center gap-3 p-3.5 rounded-xl ${meta.colorBg} border ${meta.colorBorder}`}>
                    <span className="text-xl">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${meta.color}`}>{activePlan.name}</p>
                      <p className="text-xs text-white/35">{activePlan.description}</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] text-center">
                    <p className="text-sm text-white/30">Seleccioná un plan</p>
                  </div>
                )}

                {/* Line items */}
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-white/40">Plan mensual</span>
                    <span className="text-white/70 font-medium">
                      {activePlan ? formatMoney(activePlan.monthlyAmountCents) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/40">Cantidad</span>
                    <span className="text-white/70 font-medium">
                      {months} {months === 1 ? 'mes' : 'meses'}
                    </span>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-white/[0.06] my-1" />

                  {/* Total */}
                  <div className="flex items-center justify-between">
                    <span className="text-white font-semibold">Total a pagar</span>
                    <span className="text-xl font-bold bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                      {formatMoney(totalAmountCents)}
                    </span>
                  </div>

                  {activePlan && months > 1 && (
                    <p className="text-[11px] text-white/25 text-right">
                      Equivale a {formatMoney(activePlan.monthlyAmountCents)}/mes
                    </p>
                  )}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="mx-6 mb-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3">
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    <p className="text-sm text-red-300/80">{error}</p>
                  </div>
                </div>
              )}

              {/* CTA */}
              <div className="px-6 pb-6">
                <button
                  type="button"
                  disabled={!activePlan || isSubmitting}
                  onClick={continueFlow}
                  className="group relative w-full rounded-xl bg-[#4D7CFF] hover:bg-[#3D6BEE] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3.5 font-medium text-sm transition-all duration-300 shadow-lg shadow-[#4D7CFF]/25 hover:shadow-xl hover:shadow-[#4D7CFF]/40 overflow-hidden"
                >
                  {/* Shimmer */}
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                  <span className="relative flex items-center justify-center gap-2">
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        Continuar al registro
                        <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </span>
                </button>

                {/* Trust badges */}
                <div className="flex items-center justify-center gap-4 mt-4">
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <span className="text-[11px] text-white/20">SSL seguro</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
                    </svg>
                    <span className="text-[11px] text-white/20">Stripe</span>
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
          </div>

        </div>
      </div>
    </div>
  );
}
