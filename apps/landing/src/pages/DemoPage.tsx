import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import FluidOrangeBackground from '../components/FluidOrangeBackground';
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock,
  FileText,
  Layers,
  LineChart,
  MessageCircle,
  Package,
  Receipt,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  Users,
  Utensils,
  Zap,
} from 'lucide-react';

import { API_URL } from '../lib/api';

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

/** Reveal-on-scroll using IntersectionObserver. Adds .is-visible to the ref. */
function useReveal<T extends HTMLElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add('is-visible');
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -40px 0px', ...options },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [options]);
  return ref;
}

/** Track scroll Y for header glass effect. */
function useScrolled(threshold = 12): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

/* ------------------------------------------------------------------ */
/* Reveal wrapper                                                      */
/* ------------------------------------------------------------------ */

function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}): JSX.Element {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page-scoped styles                                                  */
/* ------------------------------------------------------------------ */

const PageStyles = (): JSX.Element => (
  <style>{`
    .reveal {
      opacity: 0;
      transform: translateY(28px);
      filter: blur(8px);
      transition:
        opacity 0.85s cubic-bezier(0.22, 1, 0.36, 1),
        transform 0.85s cubic-bezier(0.22, 1, 0.36, 1),
        filter 0.85s cubic-bezier(0.22, 1, 0.36, 1);
      will-change: opacity, transform, filter;
    }
    .reveal.is-visible {
      opacity: 1;
      transform: translateY(0);
      filter: blur(0);
    }

    @keyframes demo-grad-shift {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }
    .demo-grad-text {
      background: linear-gradient(120deg, #ffd9b5 0%, #ff8a18 35%, #ff5200 60%, #ffb070 100%);
      background-size: 200% 200%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: demo-grad-shift 8s ease infinite;
    }

    @keyframes demo-orb-float {
      0%, 100% { transform: translate3d(0,0,0); }
      50% { transform: translate3d(40px, -30px, 0); }
    }
    .demo-orb { animation: demo-orb-float 14s ease-in-out infinite; }
    .demo-orb.delay-1 { animation-delay: -4s; }
    .demo-orb.delay-2 { animation-delay: -9s; }

    @keyframes demo-bubble-in {
      from { opacity: 0; transform: translateY(8px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .demo-bubble {
      animation: demo-bubble-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
    }

    @keyframes demo-typing {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-3px); opacity: 1; }
    }
    .demo-typing-dot {
      animation: demo-typing 1.2s ease-in-out infinite;
    }
    .demo-typing-dot:nth-child(2) { animation-delay: 0.15s; }
    .demo-typing-dot:nth-child(3) { animation-delay: 0.3s; }

    @keyframes demo-pulse-ring {
      0% { transform: scale(0.7); opacity: 0.6; }
      100% { transform: scale(2.1); opacity: 0; }
    }
    .demo-pulse-ring {
      animation: demo-pulse-ring 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }

    @keyframes demo-line-trace {
      0% { stroke-dashoffset: 600; }
      100% { stroke-dashoffset: 0; }
    }

    .demo-card-hover {
      transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1),
                  border-color 0.4s ease,
                  box-shadow 0.5s ease,
                  background 0.4s ease;
    }
    .demo-card-hover:hover {
      transform: translateY(-4px);
      border-color: rgba(255, 138, 24, 0.35);
      box-shadow: 0 20px 60px -20px rgba(255, 90, 0, 0.25);
      background: rgba(255, 255, 255, 0.045);
    }

    .demo-step-card {
      transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1),
                  border-color 0.4s ease,
                  box-shadow 0.5s ease;
    }
    .demo-step-card:hover {
      transform: translateY(-2px) scale(1.005);
      border-color: rgba(255, 138, 24, 0.3);
      box-shadow: 0 24px 70px -22px rgba(255, 90, 0, 0.22);
    }

    .demo-cta-btn {
      position: relative;
      isolation: isolate;
      overflow: hidden;
    }
    .demo-cta-btn::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(120deg,
        rgba(255,255,255,0) 0%,
        rgba(255,255,255,0.25) 50%,
        rgba(255,255,255,0) 100%);
      transform: translateX(-110%);
      transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
      z-index: 1;
    }
    .demo-cta-btn:hover::before {
      transform: translateX(110%);
    }

    @keyframes demo-marquee {
      0% { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }
    .demo-marquee-track {
      animation: demo-marquee 32s linear infinite;
    }

    @keyframes demo-grid-drift {
      0% { background-position: 0 0; }
      100% { background-position: 64px 64px; }
    }
    .demo-grid-bg {
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
      background-size: 64px 64px;
      animation: demo-grid-drift 28s linear infinite;
    }

    @keyframes demo-success-check {
      0% { stroke-dashoffset: 32; }
      100% { stroke-dashoffset: 0; }
    }
    .demo-success-path { stroke-dasharray: 32; animation: demo-success-check 0.6s ease-out 0.15s both; }

    @keyframes demo-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    .demo-cursor { animation: demo-blink 1s step-end infinite; }

    /* Custom select arrow */
    .demo-select {
      appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.45)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
      background-repeat: no-repeat;
      background-position: right 14px center;
      padding-right: 38px;
    }

    @media (prefers-reduced-motion: reduce) {
      .reveal { opacity: 1; transform: none; filter: none; transition: none; }
      .demo-orb, .demo-grad-text, .demo-marquee-track, .demo-grid-bg,
      .demo-typing-dot, .demo-pulse-ring, .demo-bubble {
        animation: none !important;
      }
    }
  `}</style>
);

/* ------------------------------------------------------------------ */
/* Background — animated gradient orbs + grid                          */
/* ------------------------------------------------------------------ */

const HeroBackground = (): JSX.Element => (
  <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
    {/* Fluid animated gradient — same as bynexova.com hero */}
    <FluidOrangeBackground className="absolute inset-0" seed={0.42} />

    {/* Subtle grid overlay, faded to a soft vignette */}
    <div
      className="absolute inset-0 opacity-[0.085] mix-blend-overlay"
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.85) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.85) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
        WebkitMaskImage:
          'radial-gradient(ellipse 85% 70% at 50% 40%, #000 30%, transparent 88%)',
        maskImage:
          'radial-gradient(ellipse 85% 70% at 50% 40%, #000 30%, transparent 88%)',
      }}
    />

    {/* Extra orange highlights — soft "brillos" floating over the fluid */}
    <div
      className="demo-orb absolute -top-24 left-[6%] w-[520px] h-[520px] rounded-full"
      style={{
        background:
          'radial-gradient(closest-side, rgba(255,170,80,0.55), rgba(255,82,0,0.10) 55%, transparent 75%)',
        filter: 'blur(40px)',
        mixBlendMode: 'screen',
      }}
    />
    <div
      className="demo-orb delay-1 absolute top-[22%] right-[-10%] w-[600px] h-[600px] rounded-full"
      style={{
        background:
          'radial-gradient(closest-side, rgba(255,138,24,0.45), rgba(196,53,0,0.10) 55%, transparent 75%)',
        filter: 'blur(50px)',
        mixBlendMode: 'screen',
      }}
    />
    <div
      className="demo-orb delay-2 absolute bottom-[-12%] left-[28%] w-[680px] h-[680px] rounded-full"
      style={{
        background:
          'radial-gradient(closest-side, rgba(255,90,30,0.30), transparent 70%)',
        filter: 'blur(60px)',
        mixBlendMode: 'screen',
      }}
    />

    {/* Vignette — darkens the corners, integrates with the dark page below */}
    <div
      className="absolute inset-0"
      style={{
        background:
          'radial-gradient(ellipse 95% 85% at 50% 35%, transparent 30%, rgba(8,4,0,0.45) 75%, rgba(8,4,0,0.85) 100%)',
      }}
    />

    {/* Bottom fade to dark page background */}
    <div
      className="absolute inset-x-0 bottom-0 h-56"
      style={{
        background:
          'linear-gradient(180deg, transparent 0%, hsl(228 67% 1.2% / 0.7) 55%, hsl(228 67% 1.2%) 100%)',
      }}
    />

    {/* Top hairline accent */}
    <div
      className="absolute inset-x-0 top-0 h-px"
      style={{
        background:
          'linear-gradient(90deg, transparent, rgba(255,200,140,0.55), transparent)',
      }}
    />
  </div>
);

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

const Header = (): JSX.Element => {
  const scrolled = useScrolled(10);
  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[hsl(228,67%,1.2%)]/85 backdrop-blur-xl border-b border-white/[0.06]'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-[1280px] mx-auto px-5 md:px-8 py-3.5 md:py-4 flex items-center justify-between">
        <a href="/" className="flex items-center group">
          <img
            src="/brand/logo-dark.svg"
            alt="Nexova"
            className="h-5 md:h-[22px] w-auto transition-opacity group-hover:opacity-90"
          />
        </a>
        <nav className="hidden md:flex items-center gap-8">
          {[
            { l: 'Problema', h: '#problema' },
            { l: 'Solución', h: '#solucion' },
            { l: 'Cómo funciona', h: '#funciona' },
            { l: 'Features', h: '#features' },
          ].map((i) => (
            <a
              key={i.h}
              href={i.h}
              className="text-[13px] text-white/55 hover:text-white transition-colors relative"
            >
              {i.l}
              <span className="absolute -bottom-1 left-0 right-0 h-px bg-gradient-to-r from-[#ff8a18] to-[#ff5200] scale-x-0 hover:scale-x-100 transition-transform origin-left" />
            </a>
          ))}
        </nav>
        <a
          href="#hero-form"
          className="group inline-flex items-center gap-2 rounded-full bg-white text-black text-[13px] font-medium pl-4 pr-3.5 py-2 hover:bg-white/90 transition-all hover:gap-2.5"
        >
          Quiero la demo
          <span className="w-5 h-5 rounded-full bg-black flex items-center justify-center text-white">
            <ArrowRight className="w-3 h-3" />
          </span>
        </a>
      </div>
    </header>
  );
};

/* ------------------------------------------------------------------ */
/* Hero — chat mockup visual                                           */
/* ------------------------------------------------------------------ */

type ChatLine =
  | { side: 'in'; text: string; time: string }
  | { side: 'out'; text: string; time: string }
  | { side: 'typing' };

const heroChatScript: ChatLine[] = [
  { side: 'in', text: '¡Hola! ¿Tienen el combo familiar para pedir hoy?', time: '14:02' },
  {
    side: 'out',
    text: '¡Hola! Sí, tenemos el combo familiar 🍔 ¿Para cuántas personas te lo armo?',
    time: '14:02',
  },
  { side: 'in', text: 'Para 4. ¿A cuánto sale y cuánto tarda?', time: '14:02' },
  {
    side: 'out',
    text: 'Combo x4 a $12.900. Demora 35 min aprox. ¿Te paso a tomar el pedido?',
    time: '14:02',
  },
  { side: 'in', text: 'Dale 🙌', time: '14:03' },
  { side: 'typing' },
  {
    side: 'out',
    text: 'Listo, pedido cargado al dashboard. Te aviso cuando salga ✅',
    time: '14:03',
  },
];

const HeroChatMockup = (): JSX.Element => {
  const [visible, setVisible] = useState<number>(0);
  useEffect(() => {
    let mounted = true;
    let i = 0;
    const tick = () => {
      if (!mounted) return;
      i = (i + 1) % (heroChatScript.length + 4);
      setVisible(Math.min(i, heroChatScript.length));
      if (i >= heroChatScript.length + 3) {
        // restart loop
        setTimeout(() => {
          if (mounted) {
            i = 0;
            setVisible(0);
          }
        }, 200);
      }
    };
    const interval = setInterval(tick, 1100);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="relative w-full max-w-[420px] mx-auto">
      {/* Glow ring */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[40px] opacity-50"
        style={{
          background:
            'radial-gradient(closest-side, rgba(37,211,102,0.18), transparent 70%), radial-gradient(closest-side, rgba(255,138,24,0.18), transparent 70%)',
          filter: 'blur(30px)',
        }}
      />
      {/* Phone shell */}
      <div className="relative rounded-[36px] border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.02] backdrop-blur-xl shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] overflow-hidden">
        {/* WhatsApp header */}
        <div className="flex items-center gap-3 px-5 py-4 bg-[#0b1411] border-b border-white/[0.06]">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#25D366] to-[#0c8f44] flex items-center justify-center text-white text-sm font-semibold">
            N
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-white/95 truncate">Nexova IA</div>
            <div className="flex items-center gap-1.5 text-[10.5px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 demo-typing-dot" />
              en línea
            </div>
          </div>
          <MessageCircle className="w-4 h-4 text-white/40" />
        </div>

        {/* Chat body */}
        <div
          className="px-4 py-5 space-y-2.5 min-h-[420px]"
          style={{
            background:
              'linear-gradient(180deg, #0a1310 0%, #0d1815 100%)',
          }}
        >
          {heroChatScript.slice(0, visible).map((line, idx) => {
            if (line.side === 'typing') {
              return (
                <div key={idx} className="demo-bubble flex">
                  <div className="bg-white/[0.06] border border-white/[0.06] rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/60 demo-typing-dot" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/60 demo-typing-dot" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/60 demo-typing-dot" />
                  </div>
                </div>
              );
            }
            const isOut = line.side === 'out';
            return (
              <div
                key={idx}
                className={`demo-bubble flex ${isOut ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-snug shadow-sm ${
                    isOut
                      ? 'bg-gradient-to-br from-[#1f4f3a] to-[#0f3527] text-white/95 rounded-br-sm'
                      : 'bg-white/[0.07] border border-white/[0.06] text-white/85 rounded-bl-sm'
                  }`}
                >
                  <div>{line.text}</div>
                  <div className="text-[9.5px] text-white/40 mt-1 flex justify-end items-center gap-1">
                    {line.time}
                    {isOut && <Check className="w-3 h-3 text-[#25D366]" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Input row */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.05] bg-[#0a1310]">
          <div className="flex-1 rounded-full bg-white/[0.05] border border-white/[0.06] px-4 py-2 text-[12px] text-white/40">
            Escribir mensaje...
          </div>
          <div className="w-9 h-9 rounded-full bg-[#25D366] flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-white" />
          </div>
        </div>
      </div>

      {/* Floating notif card */}
      <div
        className="absolute -right-6 md:-right-10 top-12 demo-bubble"
        style={{ animationDelay: '0.6s' }}
      >
        <div className="rounded-2xl border border-white/[0.08] bg-[hsl(228,67%,5%)]/90 backdrop-blur-xl px-4 py-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] min-w-[200px]">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-[#ff8a18]/15 border border-[#ff8a18]/20 flex items-center justify-center">
              <ShoppingBag className="w-3.5 h-3.5 text-[#ff8a18]" />
            </div>
            <div className="text-[10.5px] font-medium text-white/95">Nuevo pedido</div>
            <div className="ml-auto text-[9.5px] text-white/35">ahora</div>
          </div>
          <div className="text-[11px] text-white/55 leading-snug">
            Combo x4 · $12.900 · cargado en dashboard
          </div>
        </div>
      </div>

      {/* Floating dashboard card */}
      <div
        className="absolute -left-4 md:-left-12 bottom-10 demo-bubble"
        style={{ animationDelay: '1.2s' }}
      >
        <div className="rounded-2xl border border-white/[0.08] bg-[hsl(228,67%,5%)]/90 backdrop-blur-xl px-4 py-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
          <div className="text-[10px] uppercase tracking-wider text-white/35 mb-2">
            Pedidos hoy
          </div>
          <div className="flex items-end gap-2">
            <div className="text-2xl font-semibold text-white tracking-tight">47</div>
            <div className="flex items-center gap-1 text-emerald-400 text-[11px] mb-1">
              <LineChart className="w-3 h-3" />
              +28%
            </div>
          </div>
          <div className="flex gap-1 mt-2">
            {[24, 38, 30, 52, 41, 60, 47].map((h, i) => (
              <div
                key={i}
                className="w-2 rounded-sm bg-gradient-to-t from-[#ff5200] to-[#ff8a18]"
                style={{ height: `${h * 0.4}px`, opacity: 0.5 + i * 0.07 }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Hero form                                                            */
/* ------------------------------------------------------------------ */

type FormState = {
  name: string;
  email: string;
  whatsapp: string;
  business: string;
};

const businessTypes = [
  'Tienda / comercio',
  'E-commerce',
  'Distribuidor / mayorista',
  'Gastronomía',
  'Servicios',
  'Otro',
];

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

const DEMO_LEAD_PATH = '/api/v1/leads/demo';

const getDemoLeadUrl = (): string => {
  const base = API_URL.trim();
  if (!base) return DEMO_LEAD_PATH;
  return `${base.replace(/\/+$/, '')}${DEMO_LEAD_PATH}`;
};

async function submitDemoLead(payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(getDemoLeadUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.ok) return;

  let message = 'No se pudo enviar la solicitud. Intentá nuevamente.';
  try {
    const data = (await response.json()) as { message?: string; error?: string };
    if (data.message) message = data.message;
    else if (data.error) message = data.error;
  } catch {
    // no-op
  }
  throw new Error(message);
}

const HeroForm = (): JSX.Element => {
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    whatsapp: '',
    business: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Ingresá tu nombre.');
    if (!isValidEmail(form.email)) return setError('Email inválido.');
    if (!form.whatsapp.trim()) return setError('Ingresá tu WhatsApp.');
    if (!form.business) return setError('Elegí el tipo de negocio.');
    setLoading(true);
    try {
      await submitDemoLead({ ...form, source: 'demo-page-hero' });
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo enviar la solicitud.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="relative rounded-3xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-7 md:p-8 overflow-hidden">
        <div
          aria-hidden
          className="absolute -inset-px rounded-3xl pointer-events-none"
          style={{
            background:
              'linear-gradient(135deg, rgba(37,211,102,0.18), rgba(255,138,24,0.12))',
            mask: 'linear-gradient(#000,#000) content-box, linear-gradient(#000,#000)',
            WebkitMask: 'linear-gradient(#000,#000) content-box, linear-gradient(#000,#000)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            padding: '1px',
          }}
        />
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mx-auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="rgb(52, 211, 153)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
            <polyline points="20 6 9 17 4 12" className="demo-success-path" />
          </svg>
        </div>
        <h3 className="mt-5 text-center text-[22px] md:text-2xl font-semibold tracking-tight text-white">
          Te enviamos la demo a {form.email}
        </h3>
        <p className="mt-2 text-center text-sm text-white/55 max-w-sm mx-auto">
          Revisá tu bandeja de entrada (y spam). En minutos vas a recibir cómo
          funcionaría Nexova en tu negocio.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-white/40">
          <Clock className="w-3.5 h-3.5" />
          Respuesta en menos de 2 minutos
        </div>
      </div>
    );
  }

  return (
    <form
      id="hero-form"
      onSubmit={onSubmit}
      className="relative rounded-3xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-6 md:p-7 overflow-hidden"
    >
      {/* gradient ring */}
      <div
        aria-hidden
        className="absolute -inset-px rounded-3xl pointer-events-none opacity-70"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,138,24,0.20), rgba(255,82,0,0.05) 35%, rgba(37,211,102,0.18) 100%)',
          padding: '1px',
          WebkitMask: 'linear-gradient(#000,#000) content-box, linear-gradient(#000,#000)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />

      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ff8a18]/25 bg-[#ff8a18]/10 px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider text-[#ff8a18]">
          <Sparkles className="w-3 h-3" />
          Demo gratuita
        </span>
        <span className="text-[11px] text-white/40">2 min</span>
      </div>

      <h3 className="text-[20px] md:text-[22px] font-semibold tracking-tight text-white">
        Recibí la demo en tu mail
      </h3>
      <p className="mt-1.5 text-[13px] text-white/50">
        Sin compromiso. Te mostramos cómo Nexova puede automatizar tu operación.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3.5">
        <Field
          label="Nombre"
          value={form.name}
          onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          placeholder="Tu nombre"
          autoComplete="given-name"
        />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(v) => setForm((f) => ({ ...f, email: v }))}
          placeholder="nombre@empresa.com"
          autoComplete="email"
        />
        <Field
          label="WhatsApp"
          type="tel"
          value={form.whatsapp}
          onChange={(v) => setForm((f) => ({ ...f, whatsapp: v }))}
          placeholder="+54 9 11 1234 5678"
          autoComplete="tel"
        />
        <div className="space-y-1.5">
          <label className="block text-[10.5px] font-medium text-white/45 uppercase tracking-wider">
            Tipo de negocio
          </label>
          <div className="relative">
            <select
              value={form.business}
              onChange={(e) => setForm((f) => ({ ...f, business: e.target.value }))}
              className="demo-select w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition-all focus:border-[#ff8a18]/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(255,138,24,0.10)]"
            >
              <option value="" className="bg-[#0a0a10]">
                Elegí una opción
              </option>
              {businessTypes.map((b) => (
                <option key={b} value={b} className="bg-[#0a0a10]">
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3.5 py-2.5 text-[12.5px] text-red-300/85">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="demo-cta-btn group mt-5 relative w-full rounded-xl px-4 py-3.5 font-medium text-sm text-white shadow-[0_15px_45px_-15px_rgba(255,82,0,0.55)] disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          background:
            'linear-gradient(135deg, #ff8a18 0%, #ff5200 60%, #c43500 100%)',
        }}
      >
        <span className="relative z-[2] flex items-center justify-center gap-2">
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Enviando…
            </>
          ) : (
            <>
              Enviar y recibir demo
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </span>
      </button>

      <p className="mt-4 text-center text-[11.5px] text-white/35 leading-relaxed">
        Sin compromiso. Te mostramos cómo Nexova puede ayudarte a automatizar
        pedidos, atención y gestión.
      </p>
    </form>
  );
};

const Field = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}): JSX.Element => (
  <div className="space-y-1.5">
    <label className="block text-[10.5px] font-medium text-white/45 uppercase tracking-wider">
      {label}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all focus:border-[#ff8a18]/50 focus:bg-white/[0.05] focus:shadow-[0_0_0_3px_rgba(255,138,24,0.10)]"
    />
  </div>
);

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

const Hero = (): JSX.Element => (
  <section className="relative pt-32 md:pt-40 pb-20 md:pb-28 overflow-hidden">
    <HeroBackground />
    <div className="max-w-[1280px] mx-auto px-5 md:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
      <div className="lg:col-span-7">
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11.5px] text-white/65 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-[#25D366] demo-pulse-ring" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#25D366]" />
            </span>
            IA conectada a tu WhatsApp
            <span className="text-white/20">·</span>
            <span className="text-white/45">Demo en 2 min</span>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <h1 className="mt-6 text-[34px] sm:text-[44px] md:text-[56px] lg:text-[60px] leading-[1.04] tracking-tight font-semibold text-white">
            Si vos no respondés{' '}
            <span className="demo-grad-text">WhatsApp</span>,
            <br className="hidden md:block" /> ¿tu negocio deja de vender?
          </h1>
        </Reveal>

        <Reveal delay={220}>
          <p className="mt-6 max-w-[620px] text-[15.5px] md:text-[17px] leading-relaxed text-white/60">
            Con Nexova, una IA atiende a tus clientes por WhatsApp, toma
            pedidos, los carga automáticamente en tu dashboard y te ayuda a
            facturar con ARCA.
          </p>
        </Reveal>

        <Reveal delay={320}>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#hero-form"
              className="demo-cta-btn group inline-flex items-center gap-2 rounded-full text-white text-[14px] font-medium px-6 py-3.5 shadow-[0_15px_45px_-15px_rgba(255,82,0,0.6)]"
              style={{
                background:
                  'linear-gradient(135deg, #ff8a18 0%, #ff5200 60%, #c43500 100%)',
              }}
            >
              <span className="relative z-[2] flex items-center gap-2">
                Quiero ver la demo
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </a>
            <a
              href="#funciona"
              className="group inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 text-white/85 text-[14px] font-medium px-5 py-3.5 transition-all"
            >
              Ver cómo funciona
              <ChevronDown className="w-4 h-4 transition-transform group-hover:translate-y-0.5" />
            </a>
          </div>
        </Reveal>

        <Reveal delay={420}>
          <p className="mt-5 text-[12.5px] text-white/40 max-w-md">
            Dejanos tu mail y te enviamos una demo para que veas cómo
            funcionaría en tu negocio.
          </p>
        </Reveal>

        <Reveal delay={520}>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-[12px] text-white/40">
            {[
              { i: <Bot className="w-3.5 h-3.5" />, t: 'IA atiende 24/7' },
              { i: <Receipt className="w-3.5 h-3.5" />, t: 'Facturación con ARCA' },
              { i: <Layers className="w-3.5 h-3.5" />, t: 'Pedidos, stock y CRM' },
            ].map((it) => (
              <div key={it.t} className="flex items-center gap-1.5">
                <span className="text-[#ff8a18]/80">{it.i}</span>
                {it.t}
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      <div className="lg:col-span-5">
        <Reveal delay={120}>
          <div className="relative">
            <HeroChatMockup />
          </div>
        </Reveal>
      </div>
    </div>

    {/* Form below the fold for mobile / above for desktop */}
    <div className="max-w-[1280px] mx-auto px-5 md:px-8 mt-14 md:mt-20 lg:mt-24">
      <Reveal>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/30">
              Empezá ahora
            </p>
            <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight text-white">
              Dejanos tu mail y te enviamos la demo
            </h2>
            <p className="mt-3 text-[14px] text-white/50 max-w-lg">
              Sin compromiso. Te mostramos cómo Nexova puede ayudarte a
              automatizar pedidos, atención y gestión en tu operación real.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['Sin tarjeta', 'Cancelás cuando quieras', 'Soporte humano'].map(
                (t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11.5px] text-white/55"
                  >
                    <Check className="w-3 h-3 text-[#25D366]" />
                    {t}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="lg:col-span-5">
            <HeroForm />
          </div>
        </div>
      </Reveal>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* Marquee                                                             */
/* ------------------------------------------------------------------ */

const MarqueeStrip = (): JSX.Element => {
  const items = [
    'Pedidos perdidos',
    'Stock desactualizado',
    'Mensajes sin responder',
    'Datos fiscales a último momento',
    'Facturación lenta',
    'Clientes esperando fuera de horario',
    'Planillas que no cierran',
    'Información dispersa',
  ];
  return (
    <div className="relative py-6 border-y border-white/[0.05] overflow-hidden bg-white/[0.01]">
      <div
        className="absolute inset-y-0 left-0 w-32 z-10 pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, hsl(228,67%,1.2%) 0%, transparent 100%)',
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-32 z-10 pointer-events-none"
        style={{
          background:
            'linear-gradient(270deg, hsl(228,67%,1.2%) 0%, transparent 100%)',
        }}
      />
      <div className="flex demo-marquee-track gap-12 whitespace-nowrap text-[13px] uppercase tracking-[0.2em] text-white/35">
        {[...items, ...items].map((it, i) => (
          <span key={i} className="flex items-center gap-12">
            {it}
            <span className="text-[#ff8a18]/50">×</span>
          </span>
        ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Problem                                                             */
/* ------------------------------------------------------------------ */

const Problem = (): JSX.Element => {
  const bullets = [
    'Consultas que quedan sin responder',
    'Pedidos perdidos entre chats',
    'Stock que nadie sabe si está actualizado',
    'Datos fiscales pedidos a último momento',
    'Facturación lenta y manual',
    'Clientes esperando respuesta fuera de horario',
  ];
  return (
    <section id="problema" className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute inset-0 -z-10 demo-grid-bg opacity-30" />
      <div className="max-w-[1280px] mx-auto px-5 md:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-6">
            <Reveal>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#ff8a18]/80">
                El problema
              </p>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="mt-3 text-3xl md:text-[44px] lg:text-[48px] leading-[1.08] tracking-tight font-semibold text-white">
                Responder WhatsApp todo el día no es gestionar un negocio.{' '}
                <span className="demo-grad-text">Es sobrevivir al caos.</span>
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <div className="mt-6 space-y-4 text-[15px] text-white/55 leading-relaxed max-w-xl">
                <p>
                  Al principio parece manejable: algunos mensajes, pedidos
                  anotados a mano, stock en una planilla y facturación por
                  separado.
                </p>
                <p>
                  Pero cuando empiezan a entrar más consultas, el desorden se
                  nota: pedidos perdidos, clientes sin respuesta, datos
                  incompletos, stock desactualizado y ventas que dependen de
                  estar mirando el celular todo el tiempo.
                </p>
              </div>
            </Reveal>
          </div>

          <div className="lg:col-span-6">
            <Reveal delay={120}>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {bullets.map((b, i) => (
                  <li
                    key={b}
                    className="demo-card-hover rounded-2xl border border-white/[0.06] bg-white/[0.025] backdrop-blur-md px-4 py-3.5 flex items-start gap-3"
                  >
                    <div className="mt-0.5 w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-red-400 text-[13px] leading-none">×</span>
                    </div>
                    <div className="text-[13.5px] text-white/75 leading-snug">{b}</div>
                    <span className="ml-auto text-[10px] text-white/25 font-mono">
                      0{i + 1}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* Solution                                                            */
/* ------------------------------------------------------------------ */

const Solution = (): JSX.Element => (
  <section id="solucion" className="relative py-24 md:py-32 overflow-hidden">
    <div
      className="absolute inset-0 -z-10"
      style={{
        background:
          'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(255,138,24,0.08), transparent 60%)',
      }}
    />
    <div className="max-w-[1280px] mx-auto px-5 md:px-8">
      <div className="text-center max-w-3xl mx-auto">
        <Reveal>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#ff8a18]/80">
            La solución
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-3 text-3xl md:text-[44px] lg:text-[52px] leading-[1.08] tracking-tight font-semibold text-white">
            Nexova convierte tu WhatsApp en{' '}
            <span className="demo-grad-text">un canal de ventas automatizado</span>
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="mt-6 text-[15.5px] md:text-[17px] text-white/55 leading-relaxed">
            Con Nexova, una IA puede atender a tus clientes por WhatsApp,
            responder preguntas, tomar pedidos, pedir los datos necesarios y
            cargar todo automáticamente en tu dashboard.
          </p>
        </Reveal>
        <Reveal delay={240}>
          <p className="mt-3 text-[15px] text-white/45">
            Así tu negocio puede seguir atendiendo incluso cuando vos no estás
            disponible.
          </p>
        </Reveal>
        <Reveal delay={320}>
          <a
            href="#funciona"
            className="group mt-8 inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 text-white/85 text-[14px] font-medium px-5 py-3 transition-all"
          >
            Ver cómo funciona
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </Reveal>
      </div>

      {/* Visual flow: WhatsApp → IA → Dashboard → ARCA */}
      <Reveal delay={120}>
        <div className="mt-16 md:mt-24 relative rounded-3xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md p-6 md:p-10 overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 opacity-50"
            style={{
              background:
                'radial-gradient(circle at 0% 50%, rgba(37,211,102,0.08), transparent 50%), radial-gradient(circle at 100% 50%, rgba(255,138,24,0.08), transparent 50%)',
            }}
          />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-2 items-center relative">
            {[
              { icon: MessageCircle, label: 'WhatsApp', color: '#25D366' },
              { icon: Bot, label: 'IA Nexova', color: '#ff8a18' },
              { icon: LineChart, label: 'Dashboard', color: '#60a5fa' },
              { icon: Receipt, label: 'ARCA', color: '#a78bfa' },
            ].map((step, i) => (
              <div key={step.label} className="relative flex md:block items-center gap-3">
                <div
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur p-4 md:p-5 flex items-center gap-3 md:flex-col md:items-start md:gap-3"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{
                      background: `${step.color}1f`,
                      border: `1px solid ${step.color}33`,
                      color: step.color,
                    }}
                  >
                    <step.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/35">
                      Paso {i + 1}
                    </div>
                    <div className="text-[14px] font-medium text-white/95">{step.label}</div>
                  </div>
                </div>
                {i < 3 && (
                  <div className="hidden md:flex absolute top-1/2 -right-2 -translate-y-1/2 z-10">
                    <ArrowRight className="w-4 h-4 text-white/25" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const steps = [
  {
    n: 1,
    title: 'El cliente escribe por WhatsApp',
    text: 'Tu cliente consulta por un producto, hace una pregunta o quiere realizar un pedido.',
    icon: MessageCircle,
    accent: '#25D366',
  },
  {
    n: 2,
    title: 'La IA responde y toma el pedido',
    text: 'Nexova atiende automáticamente, guía la conversación, pide los datos necesarios y recopila la información del pedido.',
    icon: Bot,
    accent: '#ff8a18',
  },
  {
    n: 3,
    title: 'El pedido aparece en tu dashboard',
    text: 'La información queda cargada en tu panel para que puedas ver pedidos, clientes, stock y ventas de forma ordenada.',
    icon: LineChart,
    accent: '#60a5fa',
  },
  {
    n: 4,
    title: 'Gestionás y facturás desde la plataforma',
    text: 'Desde Nexova podés controlar la operación, enviar mensajes por WhatsApp y facturar con ARCA sin saltar entre mil herramientas.',
    icon: Receipt,
    accent: '#a78bfa',
  },
];

const HowItWorks = (): JSX.Element => (
  <section id="funciona" className="relative py-24 md:py-32 overflow-hidden">
    <div className="max-w-[1280px] mx-auto px-5 md:px-8">
      <div className="max-w-2xl">
        <Reveal>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#ff8a18]/80">
            Cómo funciona
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-3 text-3xl md:text-[44px] lg:text-[48px] leading-[1.08] tracking-tight font-semibold text-white">
            Así funciona <span className="demo-grad-text">Nexova</span>
          </h2>
        </Reveal>
      </div>

      <div className="mt-12 md:mt-16 grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 relative">
        {/* Connecting line on desktop (cosmetic) */}
        <div
          aria-hidden
          className="hidden md:block absolute inset-0 -z-10 pointer-events-none"
        >
          <svg className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="demoLine" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#25D366" stopOpacity="0.5" />
                <stop offset="50%" stopColor="#ff8a18" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.5" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {steps.map((step, i) => (
          <Reveal key={step.n} delay={i * 90}>
            <div
              className="demo-step-card group relative rounded-3xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-md p-6 md:p-7 h-full overflow-hidden"
            >
              <div
                aria-hidden
                className="absolute -top-20 -right-20 w-56 h-56 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: `radial-gradient(closest-side, ${step.accent}25, transparent 70%)`,
                  filter: 'blur(30px)',
                }}
              />
              <div className="flex items-start gap-4">
                <div
                  className="relative w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-transform duration-500 group-hover:scale-105"
                  style={{
                    background: `${step.accent}14`,
                    border: `1px solid ${step.accent}30`,
                    color: step.accent,
                  }}
                >
                  <step.icon className="w-6 h-6" />
                  <span
                    className="absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
                    style={{
                      background: `linear-gradient(135deg, ${step.accent}, ${step.accent}aa)`,
                      boxShadow: `0 6px 20px -8px ${step.accent}`,
                    }}
                  >
                    {step.n}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[18px] md:text-[19px] font-semibold tracking-tight text-white">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[14px] text-white/55 leading-relaxed">
                    {step.text}
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

const features = [
  {
    title: 'IA para WhatsApp',
    text: 'Respondé consultas y tomá pedidos automáticamente, incluso fuera de horario.',
    icon: Bot,
    accent: '#ff8a18',
  },
  {
    title: 'Pedidos en el dashboard',
    text: 'Cada pedido queda organizado en tu panel, sin perder información en chats.',
    icon: ShoppingBag,
    accent: '#25D366',
  },
  {
    title: 'Facturación con ARCA',
    text: 'Emití comprobantes desde la plataforma y simplificá la parte administrativa.',
    icon: FileText,
    accent: '#a78bfa',
  },
  {
    title: 'Gestión de stock',
    text: 'Controlá productos, disponibilidad y movimientos desde un solo lugar.',
    icon: Package,
    accent: '#60a5fa',
  },
  {
    title: 'Mensajería conectada',
    text: 'Mantené la comunicación con tus clientes integrada a tu operación.',
    icon: MessageCircle,
    accent: '#34d399',
  },
  {
    title: 'Métricas del negocio',
    text: 'Visualizá ventas, pedidos y actividad para tomar mejores decisiones.',
    icon: LineChart,
    accent: '#fbbf24',
  },
];

const Features = (): JSX.Element => (
  <section id="features" className="relative py-24 md:py-32 overflow-hidden">
    <div className="max-w-[1280px] mx-auto px-5 md:px-8">
      <div className="max-w-2xl">
        <Reveal>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#ff8a18]/80">
            Todo en una plataforma
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-3 text-3xl md:text-[44px] lg:text-[48px] leading-[1.08] tracking-tight font-semibold text-white">
            Todo lo que necesitás para{' '}
            <span className="demo-grad-text">dejar de operar a mano</span>
          </h2>
        </Reveal>
      </div>

      <div className="mt-12 md:mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f, i) => (
          <Reveal key={f.title} delay={i * 70}>
            <div
              className="demo-card-hover group relative rounded-3xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-md p-6 h-full overflow-hidden"
            >
              <div
                aria-hidden
                className="absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: `radial-gradient(closest-side, ${f.accent}1f, transparent 70%)`,
                  filter: 'blur(28px)',
                }}
              />
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform duration-500 group-hover:scale-105 group-hover:-rotate-3"
                style={{
                  background: `${f.accent}14`,
                  border: `1px solid ${f.accent}30`,
                  color: f.accent,
                }}
              >
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight text-white">
                {f.title}
              </h3>
              <p className="mt-2 text-[13.5px] text-white/55 leading-relaxed">
                {f.text}
              </p>
              <div className="mt-5 flex items-center gap-1.5 text-[12px] text-white/30 group-hover:text-white/55 transition-colors">
                Incluido
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* Emotional benefit                                                   */
/* ------------------------------------------------------------------ */

const Emotional = (): JSX.Element => (
  <section className="relative py-24 md:py-32 overflow-hidden">
    <div
      className="absolute inset-0 -z-10"
      style={{
        background:
          'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(255,138,24,0.08), transparent 65%)',
      }}
    />
    <div className="max-w-[1100px] mx-auto px-5 md:px-8">
      <Reveal>
        <div className="relative rounded-[28px] border border-white/[0.08] bg-white/[0.02] backdrop-blur-md p-8 md:p-14 overflow-hidden">
          <div
            aria-hidden
            className="absolute -inset-px rounded-[28px] pointer-events-none opacity-60"
            style={{
              background:
                'linear-gradient(135deg, rgba(255,138,24,0.25), rgba(255,82,0,0.05) 35%, transparent 70%)',
              padding: '1px',
              WebkitMask: 'linear-gradient(#000,#000) content-box, linear-gradient(#000,#000)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
            }}
          />
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-7">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#ff8a18]/80">
                Por qué importa
              </p>
              <h2 className="mt-3 text-3xl md:text-[40px] leading-[1.1] tracking-tight font-semibold text-white">
                Tu negocio no debería frenar cada vez que vos dejás de
                responder
              </h2>
              <p className="mt-5 text-[14.5px] md:text-[15.5px] text-white/55 leading-relaxed max-w-xl">
                Nexova está pensado para negocios que reciben consultas y
                pedidos todos los días, pero ya no quieren depender de
                WhatsApp, planillas y tareas manuales para poder vender. La IA
                se encarga de la parte repetitiva. Vos supervisás, gestionás y
                tomás mejores decisiones con la información ordenada.
              </p>
            </div>
            <div className="md:col-span-5">
              <div className="relative rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#ff8a18]/[0.08] via-white/[0.02] to-transparent backdrop-blur p-6 md:p-7">
                <Sparkles className="w-6 h-6 text-[#ff8a18]" />
                <p className="mt-4 text-[18px] md:text-[20px] font-medium leading-snug tracking-tight text-white">
                  <span className="demo-grad-text">
                    Menos pedidos perdidos.
                  </span>{' '}
                  Menos trabajo manual.{' '}
                  <span className="text-white/95">
                    Más control sobre tu operación.
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* Quick demo form                                                     */
/* ------------------------------------------------------------------ */

const QuickDemo = (): JSX.Element => {
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErr('');
    if (!isValidEmail(email)) return setErr('Email inválido.');
    if (!whatsapp.trim()) return setErr('Ingresá tu WhatsApp.');
    setLoading(true);
    try {
      await submitDemoLead({ email, whatsapp, source: 'demo-page-quick' });
      setSubmitted(true);
    } catch (submitError) {
      setErr(submitError instanceof Error ? submitError.message : 'No se pudo enviar la solicitud.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="demo" className="relative py-24 md:py-32 overflow-hidden">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 50% 60% at 50% 100%, rgba(37,211,102,0.08), transparent 65%)',
        }}
      />
      <div className="max-w-[1100px] mx-auto px-5 md:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7">
            <Reveal>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[#ff8a18]/80">
                Demo
              </p>
            </Reveal>
            <Reveal delay={80}>
              <h2 className="mt-3 text-3xl md:text-[44px] lg:text-[48px] leading-[1.08] tracking-tight font-semibold text-white">
                Mirá Nexova aplicado a{' '}
                <span className="demo-grad-text">un negocio real</span>
              </h2>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 text-[15.5px] text-white/55 leading-relaxed max-w-xl">
                Te enviamos una demo para que veas cómo la IA atiende por
                WhatsApp, toma pedidos, los carga en el dashboard y deja todo
                listo para gestionar desde la plataforma.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <p className="mt-4 text-[13px] text-white/40 max-w-md">
                Ideal para negocios que venden por WhatsApp y quieren
                automatizar atención, pedidos y gestión.
              </p>
            </Reveal>
          </div>

          <div className="lg:col-span-5">
            <Reveal delay={120}>
              {submitted ? (
                <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] backdrop-blur-xl p-7 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/25">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="rgb(52, 211, 153)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-6 h-6"
                    >
                      <polyline points="20 6 9 17 4 12" className="demo-success-path" />
                    </svg>
                  </div>
                  <p className="mt-4 text-[15px] text-white">
                    Listo, ¡te enviamos la demo!
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={submit}
                  className="rounded-3xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-6 md:p-7"
                >
                  <Field
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="nombre@empresa.com"
                  />
                  <div className="h-3" />
                  <Field
                    label="WhatsApp"
                    type="tel"
                    value={whatsapp}
                    onChange={setWhatsapp}
                    placeholder="+54 9 11 1234 5678"
                  />
                  {err && (
                    <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3.5 py-2.5 text-[12.5px] text-red-300/85">
                      {err}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="demo-cta-btn group mt-5 relative w-full rounded-xl px-4 py-3.5 font-medium text-sm text-white shadow-[0_15px_45px_-15px_rgba(255,82,0,0.55)] disabled:opacity-60"
                    style={{
                      background:
                        'linear-gradient(135deg, #ff8a18 0%, #ff5200 60%, #c43500 100%)',
                    }}
                  >
                    <span className="relative z-[2] flex items-center justify-center gap-2">
                      {loading ? 'Enviando…' : 'Quiero recibir la demo'}
                      {!loading && (
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                      )}
                    </span>
                  </button>
                </form>
              )}
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* For who                                                             */
/* ------------------------------------------------------------------ */

const personas = [
  { i: Store, t: 'Tiendas y comercios' },
  { i: Truck, t: 'Distribuidores y mayoristas' },
  { i: ShoppingBag, t: 'E-commerce' },
  { i: Utensils, t: 'Locales gastronómicos' },
  { i: MessageCircle, t: 'Negocios con atención por WhatsApp' },
  { i: Users, t: 'Equipos que gestionan pedidos, stock y facturación' },
];

const ForWho = (): JSX.Element => (
  <section className="relative py-24 md:py-32 overflow-hidden">
    <div className="max-w-[1280px] mx-auto px-5 md:px-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-5">
          <Reveal>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#ff8a18]/80">
              Para quién
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="mt-3 text-3xl md:text-[44px] lg:text-[48px] leading-[1.08] tracking-tight font-semibold text-white">
              ¿Para quién es <span className="demo-grad-text">Nexova</span>?
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 text-[15.5px] text-white/55 leading-relaxed">
              Nexova es para negocios que reciben consultas, pedidos o ventas
              por WhatsApp y necesitan ordenar su operación.
            </p>
          </Reveal>
        </div>
        <div className="lg:col-span-7">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {personas.map((p, i) => (
              <Reveal key={p.t} delay={i * 60}>
                <li className="demo-card-hover rounded-2xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-md px-5 py-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#ff8a18]/10 border border-[#ff8a18]/20 flex items-center justify-center text-[#ff8a18] flex-shrink-0">
                    <p.i className="w-4.5 h-4.5" />
                  </div>
                  <div className="text-[14px] text-white/85 leading-snug">
                    {p.t}
                  </div>
                  <Check className="ml-auto w-4 h-4 text-[#25D366]/70" />
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* Final CTA                                                           */
/* ------------------------------------------------------------------ */

const FinalCTA = (): JSX.Element => (
  <section className="relative py-24 md:py-32 overflow-hidden">
    <div className="max-w-[1280px] mx-auto px-5 md:px-8">
      <Reveal>
        <div className="relative rounded-[32px] overflow-hidden border border-white/[0.1] bg-[hsl(228,67%,2.5%)] p-10 md:p-16">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 opacity-90"
            style={{
              background:
                'radial-gradient(ellipse 70% 60% at 0% 0%, rgba(255,138,24,0.18), transparent 60%), radial-gradient(ellipse 60% 70% at 100% 100%, rgba(37,211,102,0.12), transparent 60%)',
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 demo-grid-bg opacity-40"
          />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7">
              <h2 className="text-3xl md:text-[44px] lg:text-[52px] leading-[1.05] tracking-tight font-semibold text-white">
                Dejá de perder pedidos{' '}
                <span className="demo-grad-text">entre chats</span>
              </h2>
              <p className="mt-5 text-[15.5px] md:text-[17px] text-white/55 leading-relaxed max-w-xl">
                Con Nexova, tu negocio puede atender por WhatsApp, tomar
                pedidos, cargar la información en el dashboard y facturar con
                ARCA desde una sola plataforma.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a
                  href="#hero-form"
                  className="demo-cta-btn group inline-flex items-center gap-2 rounded-full text-white text-[14px] font-medium px-6 py-3.5 shadow-[0_15px_45px_-15px_rgba(255,82,0,0.6)]"
                  style={{
                    background:
                      'linear-gradient(135deg, #ff8a18 0%, #ff5200 60%, #c43500 100%)',
                  }}
                >
                  <span className="relative z-[2] flex items-center gap-2">
                    Enviar mi mail y ver la demo
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </a>
                <span className="text-[12.5px] text-white/40">
                  Te mostramos cómo funcionaría Nexova en tu operación.
                </span>
              </div>
            </div>
            <div className="lg:col-span-5">
              <div className="relative grid grid-cols-2 gap-3">
                {[
                  { i: Bot, t: 'IA que atiende', a: '#ff8a18' },
                  { i: ShoppingBag, t: 'Pedidos al panel', a: '#25D366' },
                  { i: Receipt, t: 'Factura ARCA', a: '#a78bfa' },
                  { i: Zap, t: 'En minutos', a: '#fbbf24' },
                ].map((it) => (
                  <div
                    key={it.t}
                    className="rounded-2xl border border-white/[0.08] bg-white/[0.025] backdrop-blur p-4 flex flex-col gap-3"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{
                        background: `${it.a}14`,
                        border: `1px solid ${it.a}30`,
                        color: it.a,
                      }}
                    >
                      <it.i className="w-5 h-5" />
                    </div>
                    <div className="text-[13px] text-white/85 leading-snug">{it.t}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

const Footer = (): JSX.Element => {
  const year = useMemo(() => new Date().getFullYear(), []);
  return (
    <footer className="relative border-t border-white/[0.05] py-10 mt-12">
      <div className="max-w-[1280px] mx-auto px-5 md:px-8 flex flex-col md:flex-row items-center justify-between gap-5">
        <a href="/" className="flex items-center">
          <img
            src="/brand/logo-dark.svg"
            alt="Nexova"
            className="h-5 w-auto opacity-80"
          />
        </a>
        <div className="flex items-center gap-6 text-[12.5px] text-white/40">
          <a href="/" className="hover:text-white/70 transition-colors">
            Inicio
          </a>
          <a href="#hero-form" className="hover:text-white/70 transition-colors">
            Demo
          </a>
          <a
            href="https://dashboard.bynexova.com/"
            className="hover:text-white/70 transition-colors"
          >
            Iniciar sesión
          </a>
        </div>
        <div className="text-[12px] text-white/30">
          © {year} Nexova. Todos los derechos reservados.
        </div>
      </div>
    </footer>
  );
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function DemoPage(): JSX.Element {
  // Set tab title
  useEffect(() => {
    const prev = document.title;
    document.title = 'Demo — Nexova';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-[hsl(228,67%,1.2%)] text-white antialiased font-sans">
      <PageStyles />
      <Header />
      <main className="relative">
        <Hero />
        <MarqueeStrip />
        <Problem />
        <Solution />
        <HowItWorks />
        <Features />
        <Emotional />
        <QuickDemo />
        <ForWho />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Static asset usage helpers                                          */
/* ------------------------------------------------------------------ */

// Tiny helper to silence "unused" lint for icons that are referenced via type-only paths above.
// Keep a minimal export to avoid bundler tree-shaking surprises in some setups.
export const __nexovaDemoIcons = {
  CircleDollarSign,
};
