// @ts-nocheck
import * as b from 'react';
import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
import { gsap as ne } from 'gsap';
import { ScrollTrigger as oe } from 'gsap/ScrollTrigger';
import {
  Bell as Dl,
  Users as Gx,
  PieChart as JS,
  TrendingUp as Xx,
  LineChart as ZS,
  Instagram as ak,
  ShoppingCart as bd,
  Megaphone as ck,
  Receipt as fk,
  Twitter as gk,
  LayoutDashboard as lk,
  AlertTriangle as mk,
  Clock as nk,
  Facebook as ok,
  Settings as pk,
  MessageSquare as qx,
  CheckCircle2 as rk,
  FileText as sk,
  Linkedin as uk,
  Zap as vk,
  BarChart3 as vm,
  Package as wm,
  DollarSign as xm,
  CreditCard as ym,
  CalendarDays as Hx,
  Search as Yx,
  Sparkles as hk,
  X as Qx,
  Menu as dk,
  ChevronDown as tk,
  Diamond as ik,
  Check as ek,
} from 'lucide-react';

const f = { jsx: _jsx, jsxs: _jsxs };

ne.registerPlugin(oe);
const rv = [
    { label: 'Inicio', href: '#inicio' },
    { label: 'Funciones', href: '#funciones' },
    { label: 'Precios', href: '#precios' },
    { label: 'FAQ', href: '#faq' },
    { label: 'Contacto', href: '#contacto' },
  ],
  LE = () => {
    const [t, e] = b.useState(!1),
      [r, n] = b.useState(!1);
    return (
      b.useEffect(() => {
        const i = () => e(window.scrollY > 10);
        return (
          window.addEventListener('scroll', i),
          () => window.removeEventListener('scroll', i)
        );
      }, []),
      b.useEffect(
        () => (
          (document.body.style.overflow = r ? 'hidden' : ''),
          () => {
            document.body.style.overflow = '';
          }
        ),
        [r]
      ),
      f.jsxs('header', {
        className: `fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${t || r ? 'bg-[hsl(228,67%,1.2%)]/80 backdrop-blur-xl border-b border-white/5' : 'bg-transparent'}`,
        children: [
          f.jsxs('div', {
            className:
              'max-w-[1400px] mx-auto flex items-center justify-between px-4 md:px-6 py-3 md:py-4',
            children: [
              f.jsx('a', {
                href: '#inicio',
                className: 'flex items-center',
                children: f.jsx('img', {
                  src: '/brand/logo-dark.svg',
                  alt: 'Nexova',
                  className: 'h-5 md:h-6 w-auto',
                }),
              }),
              f.jsx('nav', {
                className: 'hidden md:flex items-center gap-8',
                children: rv.map((i) =>
                  f.jsx(
                    'a',
                    {
                      href: i.href,
                      className: 'text-white/60 hover:text-white text-sm transition-colors',
                      children: i.label,
                    },
                    i.label
                  )
                ),
              }),
              f.jsxs('div', {
                className: 'flex items-center gap-3',
                children: [
                  f.jsx('a', {
                    href: 'https://dashboard.bynexova.com/',
                    className:
                      'hidden md:block px-5 py-2 text-sm font-medium rounded-lg bg-white text-black hover:bg-white/90 transition-colors',
                    children: 'Iniciar sesión',
                  }),
                  f.jsx('button', {
                    onClick: () => n(!r),
                    className:
                      'md:hidden w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-white/70',
                    'aria-label': 'Abrir menu',
                    children: r
                      ? f.jsx(Qx, { className: 'w-4 h-4' })
                      : f.jsx(dk, { className: 'w-4 h-4' }),
                  }),
                ],
              }),
            ],
          }),
          r &&
            f.jsx('div', {
              className:
                'md:hidden border-t border-white/5 bg-[hsl(228,67%,1.2%)]/95 backdrop-blur-xl',
              children: f.jsxs('nav', {
                className: 'flex flex-col px-4 py-4 gap-1',
                children: [
                  rv.map((i) =>
                    f.jsx(
                      'a',
                      {
                        href: i.href,
                        onClick: () => n(!1),
                        className:
                          'text-white/60 hover:text-white hover:bg-white/5 text-sm py-2.5 px-3 rounded-lg transition-colors',
                        children: i.label,
                      },
                      i.label
                    )
                  ),
                  f.jsx('div', {
                    className: 'pt-3 mt-2 border-t border-white/5',
                    children: f.jsx('a', {
                      href: 'https://dashboard.bynexova.com/',
                      onClick: () => n(!1),
                      className:
                        'block w-full text-center py-2.5 text-sm font-medium rounded-lg bg-white text-black hover:bg-white/90 transition-colors',
                      children: 'Iniciar sesión',
                    }),
                  }),
                ],
              }),
            }),
        ],
      })
    );
  };
const xP = [
    { top: '6%', left: '8%', size: 2 },
    { top: '12%', left: '92%', size: 1.5 },
    { top: '18%', left: '25%', size: 1 },
    { top: '8%', left: '78%', size: 2 },
    { top: '22%', left: '15%', size: 1.5 },
    { top: '14%', left: '65%', size: 1 },
    { top: '5%', left: '45%', size: 2 },
    { top: '25%', left: '88%', size: 1.5 },
    { top: '10%', left: '35%', size: 1 },
    { top: '20%', left: '55%', size: 2 },
    { top: '15%', left: '5%', size: 1.5 },
    { top: '28%', left: '72%', size: 1 },
    { top: '7%', left: '58%', size: 2 },
    { top: '23%', left: '38%', size: 1.5 },
    { top: '11%', left: '82%', size: 1 },
    { top: '30%', left: '20%', size: 2 },
    { top: '4%', left: '68%', size: 1.5 },
    { top: '16%', left: '95%', size: 1 },
    { top: '26%', left: '48%', size: 2 },
    { top: '9%', left: '18%', size: 1.5 },
    { top: '3%', left: '52%', size: 1 },
    { top: '19%', left: '10%', size: 2 },
    { top: '27%', left: '62%', size: 1.5 },
    { top: '13%', left: '85%', size: 1 },
    { top: '24%', left: '30%', size: 2 },
    { top: '8%', left: '70%', size: 1.5 },
    { top: '17%', left: '42%', size: 1 },
    { top: '29%', left: '8%', size: 2 },
    { top: '6%', left: '28%', size: 1.5 },
    { top: '21%', left: '98%', size: 1 },
  ],
  wP = () =>
    f.jsx('div', {
      className: 'absolute inset-0 overflow-hidden pointer-events-none',
      children: xP.map((t, e) =>
        f.jsx(
          'div',
          {
            className: 'absolute rounded-full bg-white',
            style: {
              top: t.top,
              left: t.left,
              width: `${t.size}px`,
              height: `${t.size}px`,
              opacity: 0.6 + Math.random() * 0.4,
            },
          },
          e
        )
      ),
    }),
  To = 'border border-white/[0.06]',
  _P = [
    { icon: lk, label: 'Panel', active: !0 },
    { icon: vm, label: 'Métricas' },
    { icon: qx, label: 'Inbox' },
    { icon: ck, label: 'Comunicación' },
    { icon: bd, label: 'Pedidos' },
    { icon: fk, label: 'Facturación' },
    { icon: wm, label: 'Stock' },
    { icon: Gx, label: 'Clientes' },
    { icon: sk, label: 'Deudas' },
    { icon: pk, label: 'Configuración' },
  ],
  bP = [
    {
      icon: xm,
      label: 'Ventas',
      value: '$845,200',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-t-emerald-500/30',
    },
    {
      icon: bd,
      label: 'Pedidos',
      value: '142',
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-t-blue-500/30',
    },
    {
      icon: Dl,
      label: 'Nuevos',
      value: '8',
      color: 'text-orange-400',
      bg: 'bg-orange-500/10',
      border: 'border-t-orange-500/30',
    },
    {
      icon: ym,
      label: 'Pagado',
      value: '$720,850',
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      border: 'border-t-cyan-500/30',
    },
    {
      icon: Xx,
      label: 'Pendiente',
      value: '$124,350',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-t-amber-500/30',
    },
  ];
function SP() {
  const t = [
      32, 45, 38, 52, 48, 61, 55, 72, 65, 80, 74, 88, 82, 95, 90, 78, 85, 92, 98, 105, 96, 110, 102,
      115,
    ],
    e = Math.max(...t),
    r = 400,
    n = 100,
    i = t
      .map((s, a) => `${a === 0 ? 'M' : 'L'}${(a / (t.length - 1)) * r} ${n - (s / e) * (n - 8)}`)
      .join(' '),
    o = `${i} L${r} ${n} L0 ${n} Z`;
  return f.jsxs('svg', {
    viewBox: `0 0 ${r} ${n}`,
    className: 'w-full h-full',
    preserveAspectRatio: 'none',
    children: [
      f.jsx('defs', {
        children: f.jsxs('linearGradient', {
          id: 'heroChartFill',
          x1: '0',
          y1: '0',
          x2: '0',
          y2: '1',
          children: [
            f.jsx('stop', { offset: '0%', stopColor: '#f97316', stopOpacity: '0.25' }),
            f.jsx('stop', { offset: '100%', stopColor: '#f97316', stopOpacity: '0' }),
          ],
        }),
      }),
      f.jsx('path', { d: o, fill: 'url(#heroChartFill)' }),
      f.jsx('path', {
        d: i,
        fill: 'none',
        stroke: '#f97316',
        strokeWidth: '2',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ],
  });
}
function kP() {
  const t = [
      { pct: 0.45, color: '#22c55e' },
      { pct: 0.25, color: '#3b82f6' },
      { pct: 0.18, color: '#fbbf24' },
      { pct: 0.12, color: '#ef4444' },
    ],
    e = 32,
    r = 40,
    n = 40,
    i = 2 * Math.PI * e;
  let o = 0;
  return f.jsxs('svg', {
    viewBox: '0 0 80 80',
    className: 'w-full h-full',
    children: [
      t.map((s, a) => {
        const l = `${s.pct * i} ${i}`,
          u = o * 360 - 90;
        return (
          (o += s.pct),
          f.jsx(
            'circle',
            {
              cx: r,
              cy: n,
              r: e,
              fill: 'none',
              stroke: s.color,
              strokeWidth: '12',
              strokeDasharray: l,
              transform: `rotate(${u} ${r} ${n})`,
            },
            a
          )
        );
      }),
      f.jsx('circle', { cx: r, cy: n, r: '24', fill: '#060302' }),
    ],
  });
}
const CP = [
    {
      customer: 'María G.',
      items: 3,
      total: '$12,400',
      status: 'Completado',
      sc: 'text-emerald-400',
      time: 'hace 2m',
    },
    {
      customer: 'Carlos R.',
      items: 1,
      total: '$4,500',
      status: 'En proceso',
      sc: 'text-blue-400',
      time: 'hace 8m',
    },
    {
      customer: 'Ana P.',
      items: 5,
      total: '$21,000',
      status: 'Pendiente',
      sc: 'text-amber-400',
      time: 'hace 15m',
    },
    {
      customer: 'Lucas M.',
      items: 2,
      total: '$8,900',
      status: 'Completado',
      sc: 'text-emerald-400',
      time: 'hace 23m',
    },
    {
      customer: 'Sofía T.',
      items: 4,
      total: '$15,200',
      status: 'En proceso',
      sc: 'text-blue-400',
      time: 'hace 31m',
    },
  ],
  EP = [
    { name: 'Plan Empresa', revenue: '$312,000', qty: 24, pct: 100 },
    { name: 'Plan Profesional', revenue: '$245,800', qty: 58, pct: 79 },
    { name: 'Acceso API', revenue: '$128,400', qty: 86, pct: 41 },
    { name: 'Exportacion de datos', revenue: '$89,200', qty: 142, pct: 29 },
    { name: 'Almacenamiento Plus', revenue: '$69,800', qty: 210, pct: 22 },
  ],
  TP = () =>
    f.jsx('div', {
      className: 'w-full -mt-20 mb-0',
      style: { opacity: 1 },
      children: f.jsx('div', {
        className:
          '[perspective:1200px] max-w-[1050px] mx-auto translate-x-[15%] md:translate-x-[10%] lg:translate-x-[5%]',
        children: f.jsx('div', {
          className: '[transform:rotateX(20deg)] scale-[0.85] lg:scale-[0.92] origin-top',
          children: f.jsx('div', {
            className: 'relative skew-x-[.36rad]',
            children: f.jsx('div', {
              className: 'relative w-full max-w-[1100px] mx-auto mt-6 md:mt-10',
              children: f.jsxs('div', {
                className:
                  'relative overflow-hidden border border-white/10 bg-[#060302] rounded-t-2xl',
                style: {
                  boxShadow:
                    '0 0 120px inset rgba(255,255,255,0.04), 0 0 60px inset rgba(255,255,255,0.03)',
                },
                children: [
                  f.jsxs('div', {
                    className: 'flex h-[380px] sm:h-[430px] md:h-[520px]',
                    children: [
                      f.jsx('div', {
                        className: 'hidden md:block border-r border-white/[0.06]',
                        children: f.jsxs('div', {
                          className: 'w-44 flex flex-col h-full',
                          children: [
                            f.jsx('div', {
                              className: 'p-3 pb-2',
                              children: f.jsx('img', {
                                src: '/brand/logo-dark.svg',
                                alt: 'Nexova',
                                className: 'h-4 w-auto',
                              }),
                            }),
                            f.jsx('div', {
                              className: 'px-3 pb-2',
                              children: f.jsxs('div', {
                                className: `flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${To}`,
                                style: { boxShadow: '0 0 20px inset rgba(255,255,255,0.04)' },
                                children: [
                                  f.jsx(Yx, { className: 'w-3 h-3 text-white/40' }),
                                  f.jsx('span', {
                                    className: 'text-white/40 text-[10px]',
                                    children: 'Buscar...',
                                  }),
                                ],
                              }),
                            }),
                            f.jsx('div', {
                              className: 'px-3 flex-1',
                              children: f.jsx('div', {
                                className: 'flex flex-col gap-0.5',
                                children: _P.map((t) =>
                                  f.jsxs(
                                    'div',
                                    {
                                      className: `flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${t.active ? `text-white ${To}` : 'text-white/50'}`,
                                      style: t.active
                                        ? { boxShadow: '0 0 20px inset rgba(255,255,255,0.04)' }
                                        : {},
                                      children: [
                                        f.jsx(t.icon, { className: 'w-3 h-3' }),
                                        f.jsx('span', {
                                          className: 'text-[10px]',
                                          children: t.label,
                                        }),
                                      ],
                                    },
                                    t.label
                                  )
                                ),
                              }),
                            }),
                            f.jsx('div', {
                              className: 'p-3 border-t border-white/[0.06]',
                              children: f.jsxs('div', {
                                className: 'flex items-center gap-2',
                                children: [
                                  f.jsx('div', {
                                    className:
                                      'w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center',
                                    children: f.jsx('span', {
                                      className: 'text-orange-300 text-[8px] font-bold',
                                      children: 'JD',
                                    }),
                                  }),
                                  f.jsxs('div', {
                                    className: 'min-w-0',
                                    children: [
                                      f.jsx('span', {
                                        className:
                                          'text-white text-[9px] font-medium block truncate',
                                        children: 'John Doe',
                                      }),
                                      f.jsx('span', {
                                        className: 'text-white/30 text-[8px] block truncate',
                                        children: 'john@nexova.io',
                                      }),
                                    ],
                                  }),
                                ],
                              }),
                            }),
                          ],
                        }),
                      }),
                      f.jsxs('div', {
                        className: 'flex-1 flex flex-col min-w-0 overflow-hidden',
                        children: [
                          f.jsxs('div', {
                            className:
                              'flex items-center justify-between px-3 md:px-4 py-2 md:py-2.5 border-b border-white/[0.06]',
                            children: [
                              f.jsx('h2', {
                                className: 'text-white text-[11px] md:text-xs font-semibold',
                                children: 'Panel general',
                              }),
                              f.jsxs('div', {
                                className: 'flex items-center gap-2',
                                children: [
                                  f.jsxs('div', {
                                    className:
                                      'flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]',
                                    children: [
                                      f.jsx(Hx, { className: 'w-2.5 h-2.5 text-white/40' }),
                                      f.jsx('span', {
                                        className: 'text-[9px] text-white/50',
                                        children: 'Este mes',
                                      }),
                                    ],
                                  }),
                                  f.jsx('div', {
                                    className:
                                      'w-6 h-6 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center',
                                    children: f.jsx(Dl, { className: 'w-3 h-3 text-white/50' }),
                                  }),
                                ],
                              }),
                            ],
                          }),
                          f.jsxs('div', {
                            className: 'px-3 md:px-4 py-2 md:py-3',
                            children: [
                              f.jsx('h2', {
                                className: 'text-white text-xs md:text-sm font-semibold',
                                children: 'Hola, Juan',
                              }),
                              f.jsx('p', {
                                className: 'text-white/40 text-[9px] md:text-[10px]',
                                children: 'Resumen general de tu negocio',
                              }),
                            ],
                          }),
                          f.jsxs('div', {
                            className:
                              'mx-3 md:mx-4 mb-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center gap-2',
                            children: [
                              f.jsx(Dl, { className: 'w-3 h-3 text-orange-400 flex-shrink-0' }),
                              f.jsx('span', {
                                className: 'text-orange-300 text-[9px]',
                                children: '8 pedidos nuevos esperando aprobación',
                              }),
                              f.jsx('span', {
                                className:
                                  'text-orange-400 text-[8px] font-medium ml-auto whitespace-nowrap',
                                children: 'Revisar →',
                              }),
                            ],
                          }),
                          f.jsx('div', {
                            className:
                              'grid grid-cols-2 md:grid-cols-5 gap-1.5 md:gap-2 px-3 md:px-4 pb-2',
                            children: bP.map((t) =>
                              f.jsxs(
                                'div',
                                {
                                  className: `rounded-lg border-t-2 ${t.border} ${To} p-2 md:p-2.5`,
                                  style: { background: 'rgba(255,255,255,0.02)' },
                                  children: [
                                    f.jsxs('div', {
                                      className: 'flex items-center gap-1.5 mb-1.5',
                                      children: [
                                        f.jsx('div', {
                                          className: `w-5 h-5 md:w-6 md:h-6 rounded-md ${t.bg} flex items-center justify-center`,
                                          children: f.jsx(t.icon, {
                                            className: `w-2.5 h-2.5 md:w-3 md:h-3 ${t.color}`,
                                          }),
                                        }),
                                        f.jsx('span', {
                                          className: 'text-[8px] md:text-[9px] text-white/40',
                                          children: t.label,
                                        }),
                                      ],
                                    }),
                                    f.jsx('span', {
                                      className: 'text-white text-[11px] md:text-sm font-semibold',
                                      children: t.value,
                                    }),
                                  ],
                                },
                                t.label
                              )
                            ),
                          }),
                          f.jsxs('div', {
                            className: 'grid grid-cols-1 md:grid-cols-3 gap-2 px-3 md:px-4 pb-2',
                            children: [
                              f.jsxs('div', {
                                className: `md:col-span-2 rounded-lg ${To} overflow-hidden`,
                                style: { background: 'rgba(255,255,255,0.02)' },
                                children: [
                                  f.jsxs('div', {
                                    className:
                                      'px-2.5 py-2 border-b border-white/[0.04] flex items-center justify-between',
                                    children: [
                                      f.jsxs('div', {
                                        children: [
                                          f.jsx('span', {
                                            className: 'text-white text-[10px] font-medium',
                                            children: 'Ventas del mes',
                                          }),
                                          f.jsx('p', {
                                            className: 'text-white/30 text-[8px]',
                                            children: 'Ingresos y pedidos',
                                          }),
                                        ],
                                      }),
                                      f.jsx('div', {
                                        className: 'flex gap-1',
                                        children: ['Hoy', 'Semana', 'Mes'].map((t, e) =>
                                          f.jsx(
                                            'span',
                                            {
                                              className: `text-[7px] px-1.5 py-0.5 rounded ${e === 2 ? 'bg-white/10 text-white' : 'text-white/30'}`,
                                              children: t,
                                            },
                                            t
                                          )
                                        ),
                                      }),
                                    ],
                                  }),
                                  f.jsx('div', {
                                    className: 'h-20 md:h-28 p-2',
                                    children: f.jsx(SP, {}),
                                  }),
                                ],
                              }),
                              f.jsxs('div', {
                                className: `hidden md:block rounded-lg ${To} overflow-hidden`,
                                style: { background: 'rgba(255,255,255,0.02)' },
                                children: [
                                  f.jsx('div', {
                                    className: 'px-2.5 py-2 border-b border-white/[0.04]',
                                    children: f.jsx('span', {
                                      className: 'text-white text-[10px] font-medium',
                                      children: 'Estado pedidos',
                                    }),
                                  }),
                                  f.jsxs('div', {
                                    className: 'p-2 flex items-center gap-2',
                                    children: [
                                      f.jsx('div', {
                                        className: 'w-16 h-16 flex-shrink-0',
                                        children: f.jsx(kP, {}),
                                      }),
                                      f.jsx('div', {
                                        className: 'flex flex-col gap-1',
                                        children: [
                                          {
                                            label: 'Completado',
                                            color: 'bg-emerald-500',
                                            pct: '45%',
                                          },
                                          { label: 'En proceso', color: 'bg-blue-500', pct: '25%' },
                                          { label: 'Pendiente', color: 'bg-amber-500', pct: '18%' },
                                          { label: 'Cancelado', color: 'bg-red-500', pct: '12%' },
                                        ].map((t) =>
                                          f.jsxs(
                                            'div',
                                            {
                                              className: 'flex items-center gap-1',
                                              children: [
                                                f.jsx('div', {
                                                  className: `w-1 h-1 rounded-full ${t.color}`,
                                                }),
                                                f.jsx('span', {
                                                  className: 'text-[7px] text-white/40',
                                                  children: t.label,
                                                }),
                                                f.jsx('span', {
                                                  className: 'text-[7px] text-white/60 ml-auto',
                                                  children: t.pct,
                                                }),
                                              ],
                                            },
                                            t.label
                                          )
                                        ),
                                      }),
                                    ],
                                  }),
                                ],
                              }),
                            ],
                          }),
                          f.jsxs('div', {
                            className:
                              'hidden sm:grid grid-cols-1 md:grid-cols-5 gap-2 px-3 md:px-4 pb-3 flex-1 min-h-0',
                            children: [
                              f.jsxs('div', {
                                className: `md:col-span-3 rounded-lg ${To} overflow-hidden flex flex-col`,
                                style: { background: 'rgba(255,255,255,0.02)' },
                                children: [
                                  f.jsxs('div', {
                                    className:
                                      'px-2.5 py-2 border-b border-white/[0.04] flex items-center justify-between',
                                    children: [
                                      f.jsx('span', {
                                        className: 'text-white text-[10px] font-medium',
                                        children: 'Pedidos recientes',
                                      }),
                                      f.jsx('span', {
                                        className: 'text-[8px] text-orange-400/80',
                                        children: 'Ver todos',
                                      }),
                                    ],
                                  }),
                                  f.jsxs('div', {
                                    className:
                                      'grid grid-cols-5 gap-1 px-2.5 py-1 text-[7px] text-white/30 uppercase tracking-wider border-b border-white/[0.03]',
                                    children: [
                                      f.jsx('span', { children: 'Cliente' }),
                                      f.jsx('span', { children: 'Productos' }),
                                      f.jsx('span', { children: 'Total' }),
                                      f.jsx('span', { children: 'Estado' }),
                                      f.jsx('span', { children: 'Tiempo' }),
                                    ],
                                  }),
                                  f.jsx('div', {
                                    className: 'flex-1 overflow-hidden',
                                    children: CP.map((t) =>
                                      f.jsxs(
                                        'div',
                                        {
                                          className:
                                            'grid grid-cols-5 gap-1 px-2.5 py-1.5 text-[9px] border-b border-white/[0.02]',
                                          children: [
                                            f.jsx('span', {
                                              className: 'text-white/70 truncate',
                                              children: t.customer,
                                            }),
                                            f.jsx('span', {
                                              className: 'text-white/40',
                                              children: t.items,
                                            }),
                                            f.jsx('span', {
                                              className: 'text-white/80',
                                              children: t.total,
                                            }),
                                            f.jsx('span', { className: t.sc, children: t.status }),
                                            f.jsx('span', {
                                              className: 'text-white/30',
                                              children: t.time,
                                            }),
                                          ],
                                        },
                                        t.customer
                                      )
                                    ),
                                  }),
                                ],
                              }),
                              f.jsxs('div', {
                                className: `md:col-span-2 rounded-lg ${To} overflow-hidden flex flex-col`,
                                style: { background: 'rgba(255,255,255,0.02)' },
                                children: [
                                  f.jsx('div', {
                                    className: 'px-2.5 py-2 border-b border-white/[0.04]',
                                    children: f.jsx('span', {
                                      className: 'text-white text-[10px] font-medium',
                                      children: 'Top productos',
                                    }),
                                  }),
                                  f.jsx('div', {
                                    className: 'flex-1 overflow-hidden',
                                    children: EP.map((t, e) =>
                                      f.jsxs(
                                        'div',
                                        {
                                          className: 'px-2.5 py-1.5 border-b border-white/[0.02]',
                                          children: [
                                            f.jsxs('div', {
                                              className: 'flex items-center justify-between mb-0.5',
                                              children: [
                                                f.jsxs('div', {
                                                  className: 'flex items-center gap-1.5',
                                                  children: [
                                                    f.jsx('span', {
                                                      className:
                                                        'text-white/25 text-[8px] font-mono',
                                                      children: e + 1,
                                                    }),
                                                    f.jsx('span', {
                                                      className:
                                                        'text-white/80 text-[9px] truncate',
                                                      children: t.name,
                                                    }),
                                                  ],
                                                }),
                                                f.jsx('span', {
                                                  className: 'text-white/60 text-[8px]',
                                                  children: t.revenue,
                                                }),
                                              ],
                                            }),
                                            f.jsx('div', {
                                              className:
                                                'w-full h-1 rounded-full bg-white/[0.06] overflow-hidden',
                                              children: f.jsx('div', {
                                                className: 'h-full rounded-full bg-orange-500/40',
                                                style: { width: `${t.pct}%` },
                                              }),
                                            }),
                                          ],
                                        },
                                        t.name
                                      )
                                    ),
                                  }),
                                ],
                              }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
                  f.jsx('div', {
                    className: 'absolute bottom-0 left-0 right-0 h-24 md:h-32 pointer-events-none',
                    style: { background: 'linear-gradient(to top, #060302 0%, transparent 100%)' },
                  }),
                ],
              }),
            }),
          }),
        }),
      }),
    }),
  PP = '/assets/light-rays-CaJLJgNu.png';
function Af(t, e, r) {
  return Math.min(r, Math.max(e, t));
}
function Fv(t, e, r) {
  const n = t.createShader(e);
  return n
    ? (t.shaderSource(n, r),
      t.compileShader(n),
      t.getShaderParameter(n, t.COMPILE_STATUS)
        ? n
        : (console.error('[FluidBg] Shader error:', t.getShaderInfoLog(n)),
          t.deleteShader(n),
          null))
    : null;
}
function NP(t, e, r) {
  const n = Fv(t, t.VERTEX_SHADER, e),
    i = Fv(t, t.FRAGMENT_SHADER, r);
  if (!n || !i) return (n && t.deleteShader(n), i && t.deleteShader(i), null);
  const o = t.createProgram();
  return o
    ? (t.attachShader(o, n),
      t.attachShader(o, i),
      t.linkProgram(o),
      t.deleteShader(n),
      t.deleteShader(i),
      t.getProgramParameter(o, t.LINK_STATUS)
        ? o
        : (console.error('[FluidBg] Link error:', t.getProgramInfoLog(o)),
          t.deleteProgram(o),
          null))
    : (t.deleteShader(n), t.deleteShader(i), null);
}
const jP = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`,
  RP = `
  precision mediump float;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uSeed;
  /* uMouse     = smoothed fast cursor (lerp 0.14/frame)  */
  /* uMouseGhost = smoothed slow cursor (lerp 0.05/frame) — trail anchor */
  uniform vec2  uMouse;
  uniform vec2  uMouseGhost;
  uniform float uMouseEnergy;

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;
    float t  = uTime * 0.55 + uSeed * 6.2832;   /* speed: 0.55 = visibly animated idle */
    float ar = uResolution.x / uResolution.y;

    /* ── Domain warp: larger amplitude → strongly visible idle movement ── */
    vec2 wuv = uv + vec2(
      0.072 * sin(uv.y * 4.2 + t * 0.38) + 0.042 * cos(uv.x * 3.1 + t * 0.27),
      0.072 * cos(uv.x * 4.6 - t * 0.32) + 0.042 * sin(uv.y * 3.5 + t * 0.44)
    );

    /* ── Mouse PUSH: radial UV displacement away from cursor ──
       No velocity direction → no jank. Radius ~18% of canvas width. */
    float mDist  = length(uv - uMouse);
    vec2  mDir   = (uv - uMouse) / (mDist + 0.001);
    float push   = uMouseEnergy * 0.04 * exp(-mDist * mDist / 0.035);
    wuv += mDir * push;

    /* ── 8 colour poles with independent organic orbits ── */
    vec2 ap = vec2(ar, 1.0);

    /* Orbit radii bumped ~40% → strongly visible idle breathing */
    vec2 q0 = vec2(0.10 + 0.24*sin(t*0.71),        0.86 + 0.20*cos(t*0.53));
    vec2 q1 = vec2(0.50 + 0.34*cos(t*0.44),        0.64 + 0.28*sin(t*0.62));
    vec2 q2 = vec2(0.90 + 0.20*sin(t*0.57),        0.40 + 0.30*cos(t*0.47));
    vec2 q3 = vec2(0.24 + 0.30*cos(t*0.39 + 1.20), 0.14 + 0.26*sin(t*0.68));
    vec2 q4 = vec2(0.74 + 0.28*sin(t*0.51 + 2.10), 0.10 + 0.22*cos(t*0.58));
    vec2 q5 = vec2(0.07 + 0.19*cos(t*0.63 + 0.80), 0.50 + 0.33*sin(t*0.41));
    vec2 q6 = vec2(0.62 + 0.26*sin(t*0.47 + 3.00), 0.88 + 0.21*cos(t*0.36));
    vec2 q7 = vec2(0.37 + 0.30*cos(t*0.33 + 1.80), 0.45 + 0.27*sin(t*0.55));

    vec3 col0 = vec3(0.20, 0.02, 0.00);
    vec3 col1 = vec3(0.93, 0.26, 0.01);
    vec3 col2 = vec3(0.40, 0.06, 0.00);
    vec3 col3 = vec3(1.00, 0.54, 0.09);
    vec3 col4 = vec3(1.00, 0.72, 0.26);
    vec3 col5 = vec3(0.60, 0.10, 0.00);
    vec3 col6 = vec3(0.97, 0.40, 0.04);
    vec3 col7 = vec3(0.76, 0.17, 0.00);

    float EPS = 0.000035;
    float d0 = length((wuv-q0)*ap); float w0 = 1.0/(d0*d0*d0*d0+EPS);
    float d1 = length((wuv-q1)*ap); float w1 = 1.0/(d1*d1*d1*d1+EPS);
    float d2 = length((wuv-q2)*ap); float w2 = 1.0/(d2*d2*d2*d2+EPS);
    float d3 = length((wuv-q3)*ap); float w3 = 1.0/(d3*d3*d3*d3+EPS);
    float d4 = length((wuv-q4)*ap); float w4 = 1.0/(d4*d4*d4*d4+EPS);
    float d5 = length((wuv-q5)*ap); float w5 = 1.0/(d5*d5*d5*d5+EPS);
    float d6 = length((wuv-q6)*ap); float w6 = 1.0/(d6*d6*d6*d6+EPS);
    float d7 = length((wuv-q7)*ap); float w7 = 1.0/(d7*d7*d7*d7+EPS);

    float tw = w0+w1+w2+w3+w4+w5+w6+w7;
    vec3 color = (col0*w0+col1*w1+col2*w2+col3*w3+
                  col4*w4+col5*w5+col6*w6+col7*w7) / tw;

    /* ── Mouse TRAIL: bright streak from ghost → cursor ──
       ghost lags ~200ms behind → segment is always long and visible.
       Speed is the segment length in UV space (scales trail brightness). */
    vec2  seg     = uMouse - uMouseGhost;
    float segLen  = length(seg);
    float speed   = smoothstep(0.0, 0.12, segLen);    /* S-curve: no pops on micro-movements */

    /* Distance from uv to the ghost→cursor segment */
    vec2  segN    = seg / (segLen + 0.0001);
    float proj    = clamp(dot(uv - uMouseGhost, segN), 0.0, segLen);
    vec2  closest = uMouseGhost + segN * proj;
    float tDist   = length(uv - closest);

    /* Trail width: thinner when slow, wider when fast */
    float tWidth  = 0.014 + speed * 0.020;
    float trail   = uMouseEnergy * speed * exp(-(tDist * tDist) / (tWidth * tWidth));
    color += vec3(0.75, 0.42, 0.10) * trail * 0.25;  /* very subtle trail */

    /* ── Cursor glow / bloom ── */
    float glow = uMouseEnergy * 0.25 * exp(-mDist * mDist / 0.007);
    color += vec3(1.00, 0.70, 0.25) * glow;

    /* ── Soft vignette ── */
    vec2  vc  = uv * 2.0 - 1.0;
    float vig = smoothstep(1.70, 0.30, length(vc));
    color *= mix(0.80, 1.0, vig);

    gl_FragColor = vec4(color, 1.0);
  }
`;
function b_({ className: t = '', seed: e = 0 }) {
  const r = b.useRef(null);
  return (
    b.useEffect(() => {
      const n = r.current;
      if (!n || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const i = n.getContext('webgl', {
        alpha: !1,
        antialias: !1,
        depth: !1,
        stencil: !1,
        preserveDrawingBuffer: !1,
      });
      if (!i) return;
      const o = NP(i, jP, RP);
      if (!o) return;
      const s = i.createBuffer();
      if (!s) {
        i.deleteProgram(o);
        return;
      }
      (i.bindBuffer(i.ARRAY_BUFFER, s),
        i.bufferData(
          i.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          i.STATIC_DRAW
        ));
      const a = i.getAttribLocation(o, 'aPosition'),
        l = i.getUniformLocation(o, 'uResolution'),
        u = i.getUniformLocation(o, 'uTime'),
        c = i.getUniformLocation(o, 'uSeed'),
        p = i.getUniformLocation(o, 'uMouse'),
        h = i.getUniformLocation(o, 'uMouseGhost'),
        d = i.getUniformLocation(o, 'uMouseEnergy'),
        y = { x: 0.5, y: 0.5 },
        m = { x: 0.5, y: 0.5 },
        x = { x: 0.5, y: 0.5 };
      let v = 0,
        g = performance.now();
      const w = (T) => {
          const P = n.getBoundingClientRect();
          !P.width ||
            !P.height ||
            T.clientX < P.left ||
            T.clientX > P.right ||
            T.clientY < P.top ||
            T.clientY > P.bottom ||
            ((y.x = Af((T.clientX - P.left) / P.width, 0, 1)),
            (y.y = Af(1 - (T.clientY - P.top) / P.height, 0, 1)),
            (v += (1 - v) * 0.05),
            (g = performance.now()));
        },
        _ = () => {
          const T = n.parentElement;
          if (!T) return;
          const P = Math.min(window.devicePixelRatio || 1, 1.5),
            N = Math.max(1, Math.floor(T.clientWidth * P)),
            D = Math.max(1, Math.floor(T.clientHeight * P));
          (n.width !== N || n.height !== D) && ((n.width = N), (n.height = D));
        },
        S = performance.now();
      let C = 0;
      const k = (T) => {
        (_(),
          T - g > 200 && (v *= 0.993),
          (m.x += (y.x - m.x) * 0.14),
          (m.y += (y.y - m.y) * 0.14),
          (x.x += (m.x - x.x) * 0.04),
          (x.y += (m.y - x.y) * 0.04),
          i.viewport(0, 0, n.width, n.height),
          i.useProgram(o),
          i.bindBuffer(i.ARRAY_BUFFER, s),
          i.enableVertexAttribArray(a),
          i.vertexAttribPointer(a, 2, i.FLOAT, !1, 0, 0),
          i.uniform2f(l, n.width, n.height),
          i.uniform1f(u, (T - S) * 0.001),
          i.uniform1f(c, e),
          i.uniform2f(p, m.x, m.y),
          i.uniform2f(h, x.x, x.y),
          i.uniform1f(d, Af(v, 0, 1)),
          i.drawArrays(i.TRIANGLE_STRIP, 0, 4),
          (C = window.requestAnimationFrame(k)));
      };
      return (
        window.addEventListener('pointermove', w, { passive: !0 }),
        window.addEventListener('resize', _),
        _(),
        (C = window.requestAnimationFrame(k)),
        () => {
          (window.cancelAnimationFrame(C),
            window.removeEventListener('pointermove', w),
            window.removeEventListener('resize', _),
            i.deleteBuffer(s),
            i.deleteProgram(o));
        }
      );
    }, [e]),
    f.jsx('div', {
      className: `overflow-hidden ${t}`,
      style: {
        background: 'linear-gradient(135deg, #3d0800 0%, #c43500 40%, #ff5200 70%, #ff8a18 100%)',
      },
      'aria-hidden': !0,
      children: f.jsx('canvas', {
        ref: r,
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' },
      }),
    })
  );
}
ne.registerPlugin(oe);
const MP = () => {
  const t = b.useRef(null),
    e = b.useRef(null),
    r = b.useRef(null),
    n = b.useRef(null),
    i = b.useRef(null),
    o = b.useRef(null);
  return (
    b.useEffect(() => {
      if (!t.current) return;
      const s = window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        a = ne.context(() => {
          var l;
          if (!s) {
            const u = (l = r.current) == null ? void 0 : l.querySelectorAll('.hero-word');
            (ne.set(e.current, { y: -20, opacity: 0, scale: 0.95 }),
              ne.set(u ?? [], { yPercent: 120, rotateX: 45, opacity: 0 }),
              ne.set(n.current, { y: 20, opacity: 0, filter: 'blur(6px)' }),
              ne.set(i.current, { y: 20, opacity: 0 }),
              ne.set(o.current, { y: 40, opacity: 0 }),
              ne
                .timeline({ defaults: { ease: 'power4.out' }, delay: 0.15 })
                .to(e.current, { y: 0, opacity: 1, scale: 1, duration: 0.6 })
                .to(
                  u ?? [],
                  { yPercent: 0, rotateX: 0, opacity: 1, stagger: 0.04, duration: 0.7 },
                  '-=0.4'
                )
                .to(n.current, { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.6 }, '-=0.45')
                .to(i.current, { y: 0, opacity: 1, duration: 0.5 }, '-=0.4')
                .to(o.current, { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out' }, '-=0.35'));
          }
          s ||
            ne.fromTo(
              o.current,
              { y: 0, opacity: 1 },
              {
                y: 120,
                opacity: 0,
                ease: 'none',
                scrollTrigger: { trigger: t.current, start: '45% top', end: '80% top', scrub: 0.5 },
              }
            );
        }, t);
      return () => a.revert();
    }, []),
    f.jsx('section', {
      id: 'inicio',
      ref: t,
      className: 'w-full px-4 md:px-6 lg:px-8 overflow-hidden',
      children: f.jsxs('div', {
        className:
          'rounded-b-[20px] md:rounded-b-[35px] flex flex-col items-center px-4 md:px-6 pt-24 md:pt-36 pb-0 relative overflow-hidden min-h-screen',
        children: [
          f.jsx(b_, { className: 'absolute inset-0' }),
          f.jsx('img', {
            src: PP,
            alt: '',
            className: 'absolute top-0 left-0 w-full h-auto pointer-events-none select-none',
            style: { mixBlendMode: 'screen' },
            'aria-hidden': 'true',
          }),
          f.jsx(wP, {}),
          f.jsxs('a', {
            ref: e,
            href: '/checkout/?plan=pro',
            className:
              'inline-flex items-center gap-2 md:gap-3.5 pl-0.5 pr-3 md:pr-5 py-0.5 bg-white/5 rounded-[10px] border border-neutral-800 mb-8 hover:bg-white/10 transition-colors relative z-10',
            children: [
              f.jsxs('span', {
                className:
                  'inline-flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-1 md:py-1.5 bg-neutral-950 rounded-lg',
                children: [
                  f.jsx(hk, { className: 'w-2.5 h-2.5 md:w-3 md:h-3 text-zinc-300' }),
                  f.jsx('span', {
                    className: 'text-zinc-300 text-[10px] md:text-xs font-medium leading-5',
                    children: 'Bienvenidos a Nexova',
                  }),
                ],
              }),
              f.jsxs('span', {
                className: 'text-stone-300 text-[10px] md:text-xs font-medium leading-5',
                children: [
                  'Nueva version disponible v1.0 - ',
                  f.jsx('span', { className: 'text-white', children: 'Probar ahora' }),
                ],
              }),
            ],
          }),
          f.jsxs('div', {
            className: 'flex flex-col items-center gap-2.5 max-w-[800px] text-center relative z-10',
            children: [
              f.jsx('h1', {
                ref: r,
                className:
                  'text-2xl md:text-3xl lg:text-[42px] font-medium capitalize leading-tight lg:leading-[52px] text-foreground',
                style: { perspective: '600px' },
                children: 'Plataforma de analitica avanzada para impulsar tu negocio'
                  .split(' ')
                  .map((s, a) =>
                    f.jsx(
                      'span',
                      {
                        className: 'inline-block overflow-hidden align-bottom',
                        children: f.jsxs('span', {
                          className: 'hero-word inline-block will-change-transform',
                          children: [s, ' '],
                        }),
                      },
                      a
                    )
                  ),
              }),
              f.jsx('p', {
                ref: n,
                className:
                  'max-w-[541px] text-foreground/70 text-sm md:text-base font-normal leading-6 md:leading-7 tracking-tight',
                children:
                  'Centraliza ventas, pedidos, stock y mensajeria en una sola plataforma con analitica en tiempo real.',
              }),
            ],
          }),
          f.jsxs('div', {
            ref: i,
            className:
              'flex flex-col sm:flex-row items-center gap-3 sm:gap-3.5 mt-6 relative z-10 w-full sm:w-auto px-4 sm:px-0',
            children: [
              f.jsxs('a', {
                href: '/checkout',
                className: 'sparkle-btn w-full sm:w-auto justify-center',
                children: [
                  f.jsx('div', { className: 'dots_border' }),
                  f.jsxs('svg', {
                    xmlns: 'http://www.w3.org/2000/svg',
                    fill: 'none',
                    viewBox: '0 0 24 24',
                    className: 'sparkle-icon',
                    children: [
                      f.jsx('path', {
                        className: 'sparkle-path',
                        strokeLinejoin: 'round',
                        strokeLinecap: 'round',
                        stroke: 'black',
                        fill: 'black',
                        d: 'M14.187 8.096L15 5.25L15.813 8.096C16.0231 8.83114 16.4171 9.50062 16.9577 10.0413C17.4984 10.5819 18.1679 10.9759 18.903 11.186L21.75 12L18.904 12.813C18.1689 13.0231 17.4994 13.4171 16.9587 13.9577C16.4181 14.4984 16.0241 15.1679 15.814 15.903L15 18.75L14.187 15.904C13.9769 15.1689 13.5829 14.4994 13.0423 13.9587C12.5016 13.4181 11.8321 13.0241 11.097 12.814L8.25 12L11.096 11.187C11.8311 10.9769 12.5006 10.5829 13.0413 10.0423C13.5819 9.50162 13.9759 8.83214 14.186 8.097L14.187 8.096Z',
                      }),
                      f.jsx('path', {
                        className: 'sparkle-path',
                        strokeLinejoin: 'round',
                        strokeLinecap: 'round',
                        stroke: 'black',
                        fill: 'black',
                        d: 'M6 14.25L5.741 15.285C5.59267 15.8785 5.28579 16.4206 4.85319 16.8532C4.42059 17.2858 3.87853 17.5927 3.285 17.741L2.25 18L3.285 18.259C3.87853 18.4073 4.42059 18.7142 4.85319 19.1468C5.28579 19.5794 5.59267 20.1215 5.741 20.715L6 21.75L6.259 20.715C6.40725 20.1216 6.71398 19.5796 7.14639 19.147C7.5788 18.7144 8.12065 18.4075 8.714 18.259L9.75 18L8.714 17.741C8.12065 17.5925 7.5788 17.2856 7.14639 16.853C6.71398 16.4204 6.40725 15.8784 6.259 15.285L6 14.25Z',
                      }),
                      f.jsx('path', {
                        className: 'sparkle-path',
                        strokeLinejoin: 'round',
                        strokeLinecap: 'round',
                        stroke: 'black',
                        fill: 'black',
                        d: 'M6.5 4L6.303 4.5915C6.24777 4.75718 6.15472 4.90774 6.03123 5.03123C5.90774 5.15472 5.75718 5.24777 5.5915 5.303L5 5.5L5.5915 5.697C5.75718 5.75223 5.90774 5.84528 6.03123 5.96877C6.15472 6.09226 6.24777 6.24282 6.303 6.4085L6.5 7L6.697 6.4085C6.75223 6.24282 6.84528 6.09226 6.96877 5.96877C7.09226 5.84528 7.24282 5.75223 7.4085 5.697L8 5.5L7.4085 5.303C7.24282 5.24777 7.09226 5.15472 6.96877 5.03123C6.84528 4.90774 6.75223 4.75718 6.697 4.5915L6.5 4Z',
                      }),
                    ],
                  }),
                  f.jsx('span', { className: 'text_button', children: 'Empieza ahora' }),
                ],
              }),
              f.jsx('a', {
                href: '#contacto',
                className:
                  'btn-radial w-full sm:w-auto inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium bg-white/10 text-foreground border border-white/10 h-11 rounded-md px-8',
                children: 'Contacto',
              }),
            ],
          }),
          f.jsx('div', {
            className: 'mt-auto w-full translate-y-20 md:translate-y-24',
            children: f.jsx('div', { ref: o, children: f.jsx(TP, {}) }),
          }),
        ],
      }),
    })
  );
};
ne.registerPlugin(oe);
const Li = 'border border-white/[0.06]',
  Di = 'rgba(255,255,255,0.02)';
function OP({ text: t, as: e = 'h2', className: r = '' }) {
  const n = b.useRef(null);
  b.useEffect(() => {
    if (!n.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = n.current.querySelectorAll('.wave-word'),
      s = ne.timeline({
        scrollTrigger: { trigger: n.current, start: 'top 90%', end: 'top 55%', scrub: 0.8 },
      });
    return (
      s.fromTo(
        o,
        { yPercent: 120, rotateX: 40, opacity: 0 },
        { yPercent: 0, rotateX: 0, opacity: 1, stagger: 0.06, duration: 1, ease: 'power3.out' }
      ),
      () => {
        var a;
        ((a = s.scrollTrigger) == null || a.kill(), s.kill());
      }
    );
  }, []);
  const i = e;
  return f.jsx(i, {
    ref: n,
    className: r,
    style: { perspective: '600px' },
    children: t
      .split(' ')
      .map((o, s) =>
        f.jsx(
          'span',
          {
            className: 'inline-block overflow-hidden align-bottom',
            children: f.jsxs('span', {
              className: 'wave-word inline-block will-change-transform',
              children: [o, ' '],
            }),
          },
          s
        )
      ),
  });
}
function AP() {
  const t = [
      {
        icon: xm,
        label: 'Ventas',
        value: '$845,200',
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
      },
      { icon: bd, label: 'Pedidos', value: '142', color: 'text-blue-400', bg: 'bg-blue-500/10' },
      { icon: Dl, label: 'Nuevos', value: '8', color: 'text-orange-400', bg: 'bg-orange-500/10' },
      {
        icon: ym,
        label: 'Pagado',
        value: '$720,850',
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10',
      },
    ],
    e = [20, 35, 28, 42, 38, 55, 48, 62, 56, 70, 64, 78, 72, 85, 80, 92, 86, 98],
    r = Math.max(...e),
    n = 200,
    i = 50,
    o = e
      .map((s, a) => `${a === 0 ? 'M' : 'L'}${(a / (e.length - 1)) * n} ${i - (s / r) * (i - 4)}`)
      .join(' ');
  return f.jsxs('div', {
    className: 'w-full h-full flex flex-col',
    children: [
      f.jsxs('div', {
        className: 'flex items-center justify-between px-3 py-2 border-b border-white/[0.04]',
        children: [
          f.jsxs('div', {
            children: [
              f.jsx('span', {
                className: 'text-white text-[10px] font-semibold',
                children: 'Hola, John',
              }),
              f.jsx('p', {
                className: 'text-white/30 text-[7px]',
                children: 'Resumen general de tu negocio',
              }),
            ],
          }),
          f.jsxs('div', {
            className:
              'flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.04]',
            children: [
              f.jsx(Hx, { className: 'w-2 h-2 text-white/30' }),
              f.jsx('span', { className: 'text-[6px] text-white/30', children: 'Este mes' }),
            ],
          }),
        ],
      }),
      f.jsx('div', {
        className: 'grid grid-cols-4 gap-1.5 p-3 pb-2',
        children: t.map((s) =>
          f.jsxs(
            'div',
            {
              className: `rounded-md ${Li} p-1.5`,
              style: { background: Di },
              children: [
                f.jsxs('div', {
                  className: 'flex items-center gap-1 mb-1',
                  children: [
                    f.jsx('div', {
                      className: `w-3.5 h-3.5 rounded ${s.bg} flex items-center justify-center`,
                      children: f.jsx(s.icon, { className: `w-2 h-2 ${s.color}` }),
                    }),
                    f.jsx('span', { className: 'text-[6px] text-white/30', children: s.label }),
                  ],
                }),
                f.jsx('span', {
                  className: 'text-white text-[8px] font-semibold',
                  children: s.value,
                }),
              ],
            },
            s.label
          )
        ),
      }),
      f.jsxs('div', {
        className: `mx-3 rounded-md ${Li} flex-1 overflow-hidden`,
        style: { background: Di },
        children: [
          f.jsxs('div', {
            className: 'px-2 py-1.5 border-b border-white/[0.04] flex items-center justify-between',
            children: [
              f.jsx('span', {
                className: 'text-white text-[7px] font-medium',
                children: 'Ventas del mes',
              }),
              f.jsx('span', { className: 'text-[6px] text-white/20', children: 'Ingresos' }),
            ],
          }),
          f.jsx('div', {
            className: 'p-2 h-full',
            children: f.jsxs('svg', {
              viewBox: `0 0 ${n} ${i}`,
              className: 'w-full h-full',
              preserveAspectRatio: 'none',
              children: [
                f.jsx('defs', {
                  children: f.jsxs('linearGradient', {
                    id: 'b1fill',
                    x1: '0',
                    y1: '0',
                    x2: '0',
                    y2: '1',
                    children: [
                      f.jsx('stop', { offset: '0%', stopColor: '#f97316', stopOpacity: '0.3' }),
                      f.jsx('stop', { offset: '100%', stopColor: '#f97316', stopOpacity: '0' }),
                    ],
                  }),
                }),
                f.jsx('path', { d: `${o} L${n} ${i} L0 ${i} Z`, fill: 'url(#b1fill)' }),
                f.jsx('path', {
                  d: o,
                  fill: 'none',
                  stroke: '#f97316',
                  strokeWidth: '1.5',
                  strokeLinecap: 'round',
                }),
              ],
            }),
          }),
        ],
      }),
    ],
  });
}
function LP() {
  const t = [
    {
      customer: 'María G.',
      total: '$12,400',
      status: 'Completado',
      sc: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      items: 3,
    },
    {
      customer: 'Carlos R.',
      total: '$4,500',
      status: 'En proceso',
      sc: 'text-blue-400',
      bg: 'bg-blue-500/10',
      items: 1,
    },
    {
      customer: 'Ana P.',
      total: '$21,000',
      status: 'Pendiente',
      sc: 'text-amber-400',
      bg: 'bg-amber-500/10',
      items: 5,
    },
    {
      customer: 'Lucas M.',
      total: '$8,900',
      status: 'Completado',
      sc: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      items: 2,
    },
  ];
  return f.jsxs('div', {
    className: 'w-full h-full flex flex-col',
    children: [
      f.jsxs('div', {
        className: 'flex items-center justify-between px-3 py-2 border-b border-white/[0.04]',
        children: [
          f.jsx('span', {
            className: 'text-white text-[9px] font-medium',
            children: 'Pedidos recientes',
          }),
          f.jsxs('div', {
            className:
              'flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.04]',
            children: [
              f.jsx(Yx, { className: 'w-2 h-2 text-white/30' }),
              f.jsx('span', { className: 'text-[6px] text-white/30', children: 'Buscar...' }),
            ],
          }),
        ],
      }),
      f.jsxs('div', {
        className:
          'grid grid-cols-5 gap-1 px-3 py-1 text-[6px] text-white/20 uppercase tracking-wider border-b border-white/[0.03]',
        children: [
          f.jsx('span', { children: 'Cliente' }),
          f.jsx('span', { children: 'Items' }),
          f.jsx('span', { children: 'Total' }),
          f.jsx('span', { children: 'Estado' }),
          f.jsx('span', { children: 'Tiempo' }),
        ],
      }),
      t.map((e) =>
        f.jsxs(
          'div',
          {
            className: 'grid grid-cols-5 gap-1 px-3 py-1.5 text-[7px] border-b border-white/[0.02]',
            children: [
              f.jsx('span', { className: 'text-white/70', children: e.customer }),
              f.jsx('span', { className: 'text-white/30', children: e.items }),
              f.jsx('span', { className: 'text-white/80', children: e.total }),
              f.jsx('span', { className: e.sc, children: e.status }),
              f.jsx('span', { className: 'text-white/20', children: 'hace 2m' }),
            ],
          },
          e.customer
        )
      ),
    ],
  });
}
function DP() {
  const t = [
    {
      name: 'María García',
      phone: '+54 11 2345-6789',
      msg: 'Hola, quería consultar por el pedido #142',
      time: 'hace 2m',
      unread: !0,
    },
    {
      name: 'Carlos Ruiz',
      phone: '+54 11 3456-7890',
      msg: 'Bot: Tu pedido está en camino',
      time: 'hace 15m',
      unread: !1,
    },
    {
      name: 'Ana Pérez',
      phone: '+54 11 4567-8901',
      msg: '¿Tienen stock del producto X?',
      time: 'hace 1h',
      unread: !0,
    },
    {
      name: 'Lucas Martín',
      phone: '+54 11 5678-9012',
      msg: 'Bot: Gracias por tu compra!',
      time: 'hace 2h',
      unread: !1,
    },
  ];
  return f.jsxs('div', {
    className: 'w-full h-full flex flex-col',
    children: [
      f.jsxs('div', {
        className: 'flex items-center justify-between px-3 py-2 border-b border-white/[0.04]',
        children: [
          f.jsx('span', { className: 'text-white text-[9px] font-medium', children: 'Inbox' }),
          f.jsxs('div', {
            className: 'flex items-center gap-1',
            children: [
              f.jsx('div', { className: 'w-1.5 h-1.5 rounded-full bg-emerald-500' }),
              f.jsx('span', {
                className: 'text-[6px] text-emerald-400',
                children: 'WhatsApp activo',
              }),
            ],
          }),
        ],
      }),
      t.map((e) =>
        f.jsxs(
          'div',
          {
            className:
              'flex items-start gap-2 px-3 py-2 border-b border-white/[0.02] hover:bg-white/[0.01]',
            children: [
              f.jsx('div', {
                className:
                  'w-5 h-5 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0 mt-0.5',
                children: f.jsx('span', {
                  className: 'text-orange-300 text-[6px] font-bold',
                  children: e.name[0],
                }),
              }),
              f.jsxs('div', {
                className: 'flex-1 min-w-0',
                children: [
                  f.jsxs('div', {
                    className: 'flex items-center justify-between',
                    children: [
                      f.jsx('span', {
                        className: 'text-white text-[7px] font-medium',
                        children: e.name,
                      }),
                      f.jsx('span', { className: 'text-white/20 text-[6px]', children: e.time }),
                    ],
                  }),
                  f.jsx('p', { className: 'text-white/30 text-[6px] truncate', children: e.msg }),
                ],
              }),
              e.unread &&
                f.jsx('div', {
                  className: 'w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 flex-shrink-0',
                }),
            ],
          },
          e.name
        )
      ),
    ],
  });
}
function zP() {
  const t = [
    { name: 'Remera Oversize', price: '$8,500', stock: 45, low: !1 },
    { name: 'Jean Cargo', price: '$15,200', stock: 3, low: !0 },
    { name: 'Buzo Hoodie', price: '$12,800', stock: 28, low: !1 },
    { name: 'Zapatillas Run', price: '$22,000', stock: 0, low: !0 },
  ];
  return f.jsxs('div', {
    className: 'w-full h-full flex flex-col',
    children: [
      f.jsxs('div', {
        className: 'flex items-center justify-between px-3 py-2 border-b border-white/[0.04]',
        children: [
          f.jsx('span', { className: 'text-white text-[9px] font-medium', children: 'Stock' }),
          f.jsx('div', {
            className: 'flex gap-1',
            children: [
              { icon: rk, label: 'En stock', count: '124', color: 'text-emerald-400' },
              { icon: mk, label: 'Bajo', count: '8', color: 'text-amber-400' },
              { icon: nk, label: 'Sin stock', count: '3', color: 'text-red-400' },
            ].map((e) =>
              f.jsxs(
                'div',
                {
                  className: 'flex items-center gap-0.5 px-1 py-0.5 rounded bg-white/[0.03]',
                  children: [
                    f.jsx(e.icon, { className: `w-2 h-2 ${e.color}` }),
                    f.jsx('span', { className: 'text-[5px] text-white/40', children: e.count }),
                  ],
                },
                e.label
              )
            ),
          }),
        ],
      }),
      f.jsx('div', {
        className: 'grid grid-cols-2 gap-1.5 p-2.5',
        children: t.map((e) =>
          f.jsxs(
            'div',
            {
              className: `rounded-md ${Li} p-2 flex flex-col`,
              style: { background: Di },
              children: [
                f.jsx('div', {
                  className:
                    'w-full h-8 rounded bg-white/[0.03] flex items-center justify-center mb-1.5',
                  children: f.jsx(wm, { className: 'w-3 h-3 text-white/15' }),
                }),
                f.jsx('span', {
                  className: 'text-white text-[7px] font-medium truncate',
                  children: e.name,
                }),
                f.jsxs('div', {
                  className: 'flex items-center justify-between mt-0.5',
                  children: [
                    f.jsx('span', { className: 'text-white/50 text-[6px]', children: e.price }),
                    f.jsx('span', {
                      className: `text-[6px] ${e.stock === 0 ? 'text-red-400' : e.low ? 'text-amber-400' : 'text-emerald-400'}`,
                      children: e.stock === 0 ? 'Sin stock' : `${e.stock} uds`,
                    }),
                  ],
                }),
              ],
            },
            e.name
          )
        ),
      }),
    ],
  });
}
function IP() {
  const t = [65, 80, 45, 92, 58, 75, 88],
    e = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
    r = [
      { name: 'Plan Enterprise', pct: 100 },
      { name: 'Plan Professional', pct: 72 },
      { name: 'API Access', pct: 45 },
    ];
  return f.jsxs('div', {
    className: 'w-full h-full flex flex-col',
    children: [
      f.jsxs('div', {
        className: 'flex items-center justify-between px-3 py-2 border-b border-white/[0.04]',
        children: [
          f.jsx('span', { className: 'text-white text-[9px] font-medium', children: 'Métricas' }),
          f.jsxs('div', {
            className:
              'flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.04]',
            children: [
              f.jsx(vm, { className: 'w-2 h-2 text-white/30' }),
              f.jsx('span', { className: 'text-[6px] text-white/30', children: 'Últimos 30 días' }),
            ],
          }),
        ],
      }),
      f.jsx('div', {
        className: 'px-3 pt-2 pb-1',
        children: f.jsx('div', {
          className: 'flex items-end gap-1 h-14',
          children: t.map((n, i) =>
            f.jsxs(
              'div',
              {
                className: 'flex-1 flex flex-col items-center gap-0.5',
                children: [
                  f.jsx('div', {
                    className: 'w-full rounded-sm bg-orange-500/40',
                    style: { height: `${n * 0.5}px` },
                  }),
                  f.jsx('span', { className: 'text-[5px] text-white/20', children: e[i] }),
                ],
              },
              i
            )
          ),
        }),
      }),
      f.jsxs('div', {
        className: 'px-3 pt-1.5',
        children: [
          f.jsx('span', {
            className: 'text-[7px] text-white/30 mb-1 block',
            children: 'Top productos',
          }),
          r.map((n) =>
            f.jsxs(
              'div',
              {
                className: 'mb-1',
                children: [
                  f.jsxs('div', {
                    className: 'flex items-center justify-between mb-0.5',
                    children: [
                      f.jsx('span', { className: 'text-[6px] text-white/60', children: n.name }),
                      f.jsxs('span', {
                        className: 'text-[6px] text-white/30',
                        children: [n.pct, '%'],
                      }),
                    ],
                  }),
                  f.jsx('div', {
                    className: 'w-full h-1 rounded-full bg-white/[0.06]',
                    children: f.jsx('div', {
                      className: 'h-full rounded-full bg-orange-500/50',
                      style: { width: `${n.pct}%` },
                    }),
                  }),
                ],
              },
              n.name
            )
          ),
        ],
      }),
    ],
  });
}
const FP = () => {
  const t = b.useRef(null),
    e = b.useRef(null),
    r = b.useRef(null);
  return (
    b.useEffect(() => {
      if (!t.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const n = ne.context(() => {
        var o;
        ne.fromTo(
          e.current,
          { y: 30, opacity: 0, filter: 'blur(6px)' },
          {
            y: 0,
            opacity: 1,
            filter: 'blur(0px)',
            ease: 'none',
            scrollTrigger: { trigger: e.current, start: 'top 92%', end: 'top 65%', scrub: 0.8 },
          }
        );
        const i = (o = r.current) == null ? void 0 : o.querySelectorAll('.bento-card');
        i != null &&
          i.length &&
          ne
            .timeline({
              scrollTrigger: { trigger: r.current, start: 'top 85%', end: 'top 30%', scrub: 0.8 },
            })
            .fromTo(
              i,
              { y: 80, opacity: 0, scale: 0.94 },
              { y: 0, opacity: 1, scale: 1, stagger: 0.08, duration: 1, ease: 'power2.out' }
            );
      }, t);
      return () => n.revert();
    }, []),
    f.jsxs('section', {
      id: 'funciones',
      ref: t,
      className: 'w-full px-4 md:px-6 lg:px-8 py-16 md:py-20',
      children: [
        f.jsxs('div', {
          className: 'text-center mb-10 md:mb-12',
          children: [
            f.jsx(OP, {
              text: 'Funciones simples pero poderosas',
              as: 'h2',
              className: 'text-2xl md:text-3xl font-medium text-foreground mb-3',
            }),
            f.jsx('p', {
              ref: e,
              className: 'text-foreground/60 text-sm md:text-base max-w-lg mx-auto',
              children:
                'Todo lo que necesitás para gestionar tu negocio en un solo lugar: ventas, pedidos, stock, mensajes y métricas.',
            }),
          ],
        }),
        f.jsxs('div', {
          ref: r,
          className: 'max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-3',
          children: [
            f.jsxs('div', {
              className:
                'bento-card md:row-span-2 rounded-2xl border border-white/10 p-5 md:p-6 pb-0 pr-0 flex flex-col overflow-hidden',
              style: {
                background: 'linear-gradient(180deg, #1a0f08 0%, #120a05 50%, #060302 100%)',
              },
              children: [
                f.jsx('h3', {
                  className: 'text-base md:text-lg font-medium text-foreground mb-2',
                  children: 'Panel de control unificado',
                }),
                f.jsx('p', {
                  className: 'text-foreground/60 text-xs md:text-sm mb-4 pr-5 md:pr-6',
                  children:
                    'Visualizá ventas, pedidos y métricas en tiempo real. Todo sincronizado y actualizado al instante.',
                }),
                f.jsx('div', {
                  className: `flex-1 rounded-tl-lg ${Li} overflow-hidden`,
                  style: { background: Di },
                  children: f.jsx(AP, {}),
                }),
              ],
            }),
            f.jsxs('div', {
              className:
                'bento-card bg-[#0e0906] rounded-2xl border border-white/10 p-5 md:p-6 flex flex-col overflow-hidden',
              children: [
                f.jsx('div', {
                  className: `flex-1 mb-4 rounded-lg ${Li} overflow-hidden`,
                  style: { background: Di },
                  children: f.jsx(LP, {}),
                }),
                f.jsx('h3', {
                  className: 'text-base md:text-lg font-medium text-foreground mb-2',
                  children: 'Gestión de pedidos en tiempo real',
                }),
                f.jsx('p', {
                  className: 'text-foreground/60 text-xs md:text-sm',
                  children:
                    'Seguí cada pedido de principio a fin: estados, pagos, clientes y comprobantes en un solo lugar.',
                }),
              ],
            }),
            f.jsxs('div', {
              className:
                'bento-card bg-[#0e0906] rounded-2xl border border-white/10 p-5 md:p-6 flex flex-col overflow-hidden',
              children: [
                f.jsx('div', {
                  className: `flex-1 mb-4 rounded-lg ${Li} overflow-hidden`,
                  style: { background: Di },
                  children: f.jsx(DP, {}),
                }),
                f.jsx('h3', {
                  className: 'text-base md:text-lg font-medium text-foreground mb-2',
                  children: 'Mensajería integrada con WhatsApp',
                }),
                f.jsx('p', {
                  className: 'text-foreground/60 text-xs md:text-sm',
                  children:
                    'Conversaciones con clientes vinculadas a pedidos. Bot automático y respuestas en tiempo real.',
                }),
              ],
            }),
            f.jsxs('div', {
              className:
                'bento-card bg-[#0e0906] rounded-2xl border border-white/10 p-5 md:p-6 flex flex-col overflow-hidden',
              children: [
                f.jsx('div', {
                  className: `flex-1 mb-4 rounded-lg ${Li} overflow-hidden`,
                  style: { background: Di },
                  children: f.jsx(zP, {}),
                }),
                f.jsx('h3', {
                  className: 'text-base md:text-lg font-medium text-foreground mb-2',
                  children: 'Control de inventario inteligente',
                }),
                f.jsx('p', {
                  className: 'text-foreground/60 text-xs md:text-sm',
                  children:
                    'Alertas de stock bajo, categorías, imágenes y gestión de productos con actualización automática.',
                }),
              ],
            }),
            f.jsxs('div', {
              className:
                'bento-card bg-[#0e0906] rounded-2xl border border-white/10 p-5 md:p-6 flex flex-col overflow-hidden',
              children: [
                f.jsx('div', {
                  className: `flex-1 mb-4 rounded-lg ${Li} overflow-hidden`,
                  style: { background: Di },
                  children: f.jsx(IP, {}),
                }),
                f.jsx('h3', {
                  className: 'text-base md:text-lg font-medium text-foreground mb-2',
                  children: 'Métricas avanzadas con IA',
                }),
                f.jsx('p', {
                  className: 'text-foreground/60 text-xs md:text-sm',
                  children:
                    'Análisis de ventas, productos top, métodos de pago y recomendaciones automáticas con inteligencia artificial.',
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );
};
ne.registerPlugin(oe);
function $P({ text: t, as: e = 'h2', className: r = '' }) {
  const n = b.useRef(null);
  b.useEffect(() => {
    if (!n.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = n.current.querySelectorAll('.wave-word'),
      s = ne.timeline({
        scrollTrigger: { trigger: n.current, start: 'top 90%', end: 'top 55%', scrub: 0.8 },
      });
    return (
      s.fromTo(
        o,
        { yPercent: 120, rotateX: 40, opacity: 0 },
        { yPercent: 0, rotateX: 0, opacity: 1, stagger: 0.06, duration: 1, ease: 'power3.out' }
      ),
      () => {
        var a;
        ((a = s.scrollTrigger) == null || a.kill(), s.kill());
      }
    );
  }, []);
  const i = e;
  return f.jsx(i, {
    ref: n,
    className: r,
    style: { perspective: '600px' },
    children: t
      .split(' ')
      .map((o, s) =>
        f.jsx(
          'span',
          {
            className: 'inline-block overflow-hidden align-bottom',
            children: f.jsxs('span', {
              className: 'wave-word inline-block will-change-transform',
              children: [o, ' '],
            }),
          },
          s
        )
      ),
  });
}
const BP = [
    { label: 'Ventas', value: '$12,450', icon: xm, color: 'emerald', change: '+18%' },
    { label: 'Pedidos', value: '284', icon: bd, color: 'blue', change: '+12%' },
    { label: 'Nuevos', value: '23', icon: Dl, color: 'orange', change: '+5' },
    { label: 'Pagado', value: '$10,230', icon: ym, color: 'cyan', change: '+15%' },
    { label: 'Pendiente', value: '$2,220', icon: Xx, color: 'amber', change: '-8%' },
  ],
  UP = {
    emerald: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-t-emerald-500/40',
    },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-t-blue-500/40' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-t-orange-500/40' },
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-t-cyan-500/40' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-t-amber-500/40' },
  };
function VP({ color: t = '#22c55e' }) {
  const e = [4, 8, 6, 12, 9, 15, 11, 18, 14, 20, 16, 22, 19, 17, 24, 21, 26, 23, 28],
    r = Math.max(...e),
    n = 200,
    i = 50,
    o = e
      .map((a, l) => `${l === 0 ? 'M' : 'L'}${(l / (e.length - 1)) * n} ${i - (a / r) * i}`)
      .join(' '),
    s = `${o} L${n} ${i} L0 ${i} Z`;
  return f.jsxs('svg', {
    viewBox: `0 0 ${n} ${i}`,
    className: 'w-full h-full',
    preserveAspectRatio: 'none',
    children: [
      f.jsx('defs', {
        children: f.jsxs('linearGradient', {
          id: 'sparkFill',
          x1: '0',
          y1: '0',
          x2: '0',
          y2: '1',
          children: [
            f.jsx('stop', { offset: '0%', stopColor: t, stopOpacity: '0.3' }),
            f.jsx('stop', { offset: '100%', stopColor: t, stopOpacity: '0' }),
          ],
        }),
      }),
      f.jsx('path', { d: s, fill: 'url(#sparkFill)' }),
      f.jsx('path', {
        d: o,
        fill: 'none',
        stroke: t,
        strokeWidth: '2',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ],
  });
}
function WP() {
  const t = [
      { pct: 0.42, color: '#22c55e' },
      { pct: 0.28, color: '#60a5fa' },
      { pct: 0.18, color: '#fbbf24' },
      { pct: 0.12, color: '#6366f1' },
    ],
    e = 40,
    r = 50,
    n = 50,
    i = 2 * Math.PI * e;
  let o = 0;
  return f.jsxs('svg', {
    viewBox: '0 0 100 100',
    className: 'w-full h-full',
    children: [
      t.map((s, a) => {
        const l = `${s.pct * i} ${i}`,
          u = o * 360 - 90;
        return (
          (o += s.pct),
          f.jsx(
            'circle',
            {
              cx: r,
              cy: n,
              r: e,
              fill: 'none',
              stroke: s.color,
              strokeWidth: '16',
              strokeDasharray: l,
              transform: `rotate(${u} ${r} ${n})`,
              strokeLinecap: 'butt',
            },
            a
          )
        );
      }),
      f.jsx('circle', { cx: r, cy: n, r: '30', fill: '#060302' }),
    ],
  });
}
const HP = [
    {
      icon: ZS,
      title: 'Analitica en tiempo real',
      desc: 'Tendencias de ventas, rendimiento de pedidos e ingresos con graficos interactivos.',
    },
    {
      icon: qx,
      title: 'Mensajeria integrada',
      desc: 'Conversaciones de WhatsApp conectadas directamente con clientes y pedidos.',
    },
    {
      icon: wm,
      title: 'Inventario inteligente',
      desc: 'Control de stock con alertas, categorias y gestion flexible por vistas.',
    },
    {
      icon: Gx,
      title: 'Inteligencia de clientes',
      desc: 'Perfiles completos con historial de compras, comportamiento y datos clave.',
    },
    {
      icon: vk,
      title: 'Insights con IA',
      desc: 'Analisis automatico con recomendaciones accionables para optimizar tu negocio.',
    },
    {
      icon: JS,
      title: 'Metricas avanzadas',
      desc: 'Paneles con productos top, metodos de pago y comparativas por periodos.',
    },
  ],
  qP = () => {
    const t = b.useRef(null),
      e = b.useRef(null),
      r = b.useRef(null),
      n = b.useRef(null);
    return (
      b.useEffect(() => {
        if (!t.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const i = ne.context(() => {
          var s;
          (ne.fromTo(
            e.current,
            { y: 30, opacity: 0, filter: 'blur(6px)' },
            {
              y: 0,
              opacity: 1,
              filter: 'blur(0px)',
              ease: 'none',
              scrollTrigger: { trigger: e.current, start: 'top 92%', end: 'top 65%', scrub: 0.8 },
            }
          ),
            ne.fromTo(
              r.current,
              { y: 80, opacity: 0, scale: 0.94 },
              {
                y: 0,
                opacity: 1,
                scale: 1,
                ease: 'power2.out',
                scrollTrigger: { trigger: r.current, start: 'top 90%', end: 'top 45%', scrub: 0.8 },
              }
            ));
          const o = (s = n.current) == null ? void 0 : s.querySelectorAll('.highlight-card');
          o != null &&
            o.length &&
            ne.fromTo(
              o,
              { y: 60, opacity: 0 },
              {
                y: 0,
                opacity: 1,
                stagger: 0.08,
                duration: 1,
                ease: 'power2.out',
                scrollTrigger: { trigger: n.current, start: 'top 88%', end: 'top 40%', scrub: 0.8 },
              }
            );
        }, t);
        return () => i.revert();
      }, []),
      f.jsx('section', {
        ref: t,
        className: 'w-full py-16 md:py-20 px-4 md:px-6 lg:px-8',
        children: f.jsxs('div', {
          className: 'max-w-[900px] mx-auto',
          children: [
            f.jsxs('div', {
              className: 'text-center mb-10 md:mb-12',
              children: [
                f.jsx($P, {
                  text: 'Todo lo que necesitas en un solo panel',
                  as: 'h2',
                  className: 'text-2xl md:text-3xl font-medium text-foreground mb-3',
                }),
                f.jsx('p', {
                  ref: e,
                  className: 'text-foreground/60 text-sm md:text-base max-w-lg mx-auto',
                  children:
                    'Desde ventas en tiempo real hasta insights con IA, gestiona toda tu operacion desde una interfaz potente y unificada.',
                }),
              ],
            }),
            f.jsx('div', {
              ref: r,
              className: 'mb-12 md:mb-16',
              children: f.jsxs('div', {
                className: 'rounded-2xl border border-white/10 overflow-hidden',
                style: {
                  background: '#060302',
                  boxShadow:
                    '0 0 80px rgba(255,150,50,0.04), 0 0 40px inset rgba(255,255,255,0.03)',
                },
                children: [
                  f.jsxs('div', {
                    className:
                      'flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]',
                    children: [
                      f.jsxs('div', {
                        className: 'flex items-center gap-2',
                        children: [
                          f.jsx('div', { className: 'w-2.5 h-2.5 rounded-full bg-red-500/60' }),
                          f.jsx('div', { className: 'w-2.5 h-2.5 rounded-full bg-yellow-500/60' }),
                          f.jsx('div', { className: 'w-2.5 h-2.5 rounded-full bg-green-500/60' }),
                        ],
                      }),
                      f.jsx('div', {
                        className:
                          'flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]',
                        children: f.jsx('span', {
                          className: 'text-[9px] text-white/30',
                          children: 'app.nexova.io/dashboard',
                        }),
                      }),
                      f.jsx('div', { className: 'w-16' }),
                    ],
                  }),
                  f.jsxs('div', {
                    className: 'p-3 md:p-4 pb-3',
                    children: [
                      f.jsxs('div', {
                        className: 'flex items-center justify-between mb-3 md:mb-4',
                        children: [
                          f.jsxs('div', {
                            children: [
                              f.jsx('h3', {
                                className: 'text-white text-xs md:text-sm font-semibold',
                                children: 'Bienvenido, John',
                              }),
                              f.jsx('p', {
                                className: 'text-white/40 text-[9px] md:text-[10px]',
                                children: 'Este es el resumen de tu operacion de hoy',
                              }),
                            ],
                          }),
                          f.jsxs('div', {
                            className:
                              'hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]',
                            children: [
                              f.jsx(vm, { className: 'w-3 h-3 text-white/40' }),
                              f.jsx('span', {
                                className: 'text-[10px] text-white/50',
                                children: 'Este mes',
                              }),
                            ],
                          }),
                        ],
                      }),
                      f.jsx('div', {
                        className: 'grid grid-cols-3 md:grid-cols-5 gap-1.5 md:gap-2',
                        children: BP.map((i) => {
                          const o = UP[i.color];
                          return f.jsxs(
                            'div',
                            {
                              className: `rounded-lg md:rounded-xl border border-white/[0.06] border-t-2 ${o.border} p-2 md:p-3`,
                              style: { background: 'rgba(255,255,255,0.02)' },
                              children: [
                                f.jsxs('div', {
                                  className: 'flex items-center gap-1.5 md:gap-2 mb-1.5 md:mb-2',
                                  children: [
                                    f.jsx('div', {
                                      className: `w-5 h-5 md:w-7 md:h-7 rounded-md md:rounded-lg ${o.bg} flex items-center justify-center`,
                                      children: f.jsx(i.icon, {
                                        className: `w-2.5 h-2.5 md:w-3.5 md:h-3.5 ${o.text}`,
                                      }),
                                    }),
                                    f.jsx('span', {
                                      className: 'text-[8px] md:text-[9px] text-white/40',
                                      children: i.label,
                                    }),
                                  ],
                                }),
                                f.jsxs('div', {
                                  className: 'flex items-baseline gap-1',
                                  children: [
                                    f.jsx('span', {
                                      className: 'text-white text-[11px] md:text-sm font-semibold',
                                      children: i.value,
                                    }),
                                    f.jsx('span', {
                                      className: `text-[8px] md:text-[9px] hidden sm:inline ${i.change.startsWith('+') ? 'text-emerald-400' : 'text-red-400'}`,
                                      children: i.change,
                                    }),
                                  ],
                                }),
                              ],
                            },
                            i.label
                          );
                        }),
                      }),
                    ],
                  }),
                  f.jsxs('div', {
                    className:
                      'grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3 px-3 md:px-4 pb-3 md:pb-4',
                    children: [
                      f.jsxs('div', {
                        className:
                          'md:col-span-2 rounded-xl border border-white/[0.06] overflow-hidden',
                        style: { background: 'rgba(255,255,255,0.02)' },
                        children: [
                          f.jsxs('div', {
                            className:
                              'px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between',
                            children: [
                              f.jsxs('div', {
                                children: [
                                  f.jsx('span', {
                                    className: 'text-white text-[11px] font-medium',
                                    children: 'Tendencia de ventas',
                                  }),
                                  f.jsx('p', {
                                    className: 'text-white/30 text-[9px]',
                                    children: 'Ingresos a lo largo del tiempo',
                                  }),
                                ],
                              }),
                              f.jsx('div', {
                                className: 'flex gap-1',
                                children: ['1D', '1S', '1M'].map((i, o) =>
                                  f.jsx(
                                    'span',
                                    {
                                      className: `text-[8px] px-1.5 py-0.5 rounded ${o === 2 ? 'bg-white/10 text-white' : 'text-white/30'}`,
                                      children: i,
                                    },
                                    i
                                  )
                                ),
                              }),
                            ],
                          }),
                          f.jsx('div', {
                            className: 'h-28 md:h-36 p-3',
                            children: f.jsx(VP, { color: '#f97316' }),
                          }),
                        ],
                      }),
                      f.jsxs('div', {
                        className: 'rounded-xl border border-white/[0.06] overflow-hidden',
                        style: { background: 'rgba(255,255,255,0.02)' },
                        children: [
                          f.jsxs('div', {
                            className: 'px-3 py-2.5 border-b border-white/[0.06]',
                            children: [
                              f.jsx('span', {
                                className: 'text-white text-[11px] font-medium',
                                children: 'Estado de pedidos',
                              }),
                              f.jsx('p', {
                                className: 'text-white/30 text-[9px]',
                                children: 'Distribucion por estado',
                              }),
                            ],
                          }),
                          f.jsxs('div', {
                            className: 'p-3 flex items-center gap-3',
                            children: [
                              f.jsx('div', {
                                className: 'w-20 h-20 md:w-24 md:h-24 flex-shrink-0',
                                children: f.jsx(WP, {}),
                              }),
                              f.jsx('div', {
                                className: 'flex flex-col gap-1.5',
                                children: [
                                  { label: 'Completado', color: 'bg-emerald-500', pct: '42%' },
                                  { label: 'En proceso', color: 'bg-blue-500', pct: '28%' },
                                  { label: 'Pendiente', color: 'bg-amber-500', pct: '18%' },
                                  { label: 'Nuevo', color: 'bg-indigo-500', pct: '12%' },
                                ].map((i) =>
                                  f.jsxs(
                                    'div',
                                    {
                                      className: 'flex items-center gap-1.5',
                                      children: [
                                        f.jsx('div', {
                                          className: `w-1.5 h-1.5 rounded-full ${i.color}`,
                                        }),
                                        f.jsx('span', {
                                          className: 'text-[9px] text-white/50',
                                          children: i.label,
                                        }),
                                        f.jsx('span', {
                                          className: 'text-[9px] text-white/70 ml-auto',
                                          children: i.pct,
                                        }),
                                      ],
                                    },
                                    i.label
                                  )
                                ),
                              }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
                  f.jsx('div', {
                    className: 'hidden sm:block px-3 md:px-4 pb-3 md:pb-4',
                    children: f.jsxs('div', {
                      className: 'rounded-xl border border-white/[0.06] overflow-hidden',
                      style: { background: 'rgba(255,255,255,0.02)' },
                      children: [
                        f.jsxs('div', {
                          className:
                            'px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between',
                          children: [
                            f.jsx('span', {
                              className: 'text-white text-[11px] font-medium',
                              children: 'Pedidos recientes',
                            }),
                            f.jsx('span', {
                              className: 'text-[9px] text-orange-400/80',
                              children: 'Ver todos',
                            }),
                          ],
                        }),
                        f.jsxs('div', {
                          className:
                            'grid grid-cols-5 gap-2 px-3 py-1.5 text-[8px] text-white/30 uppercase tracking-wider border-b border-white/[0.04]',
                          children: [
                            f.jsx('span', { children: 'Cliente' }),
                            f.jsx('span', { children: 'Productos' }),
                            f.jsx('span', { children: 'Total' }),
                            f.jsx('span', { children: 'Estado' }),
                            f.jsx('span', { children: 'Tiempo' }),
                          ],
                        }),
                        [
                          {
                            name: 'Maria G.',
                            items: 3,
                            total: '$1,240',
                            status: 'Completado',
                            statusColor: 'text-emerald-400',
                            time: 'hace 2m',
                          },
                          {
                            name: 'Carlos R.',
                            items: 1,
                            total: '$450',
                            status: 'En proceso',
                            statusColor: 'text-blue-400',
                            time: 'hace 8m',
                          },
                          {
                            name: 'Ana P.',
                            items: 5,
                            total: '$2,100',
                            status: 'Pendiente',
                            statusColor: 'text-amber-400',
                            time: 'hace 15m',
                          },
                          {
                            name: 'Lucas M.',
                            items: 2,
                            total: '$890',
                            status: 'Completado',
                            statusColor: 'text-emerald-400',
                            time: 'hace 23m',
                          },
                        ].map((i) =>
                          f.jsxs(
                            'div',
                            {
                              className:
                                'grid grid-cols-5 gap-2 px-3 py-2 text-[10px] border-b border-white/[0.03]',
                              children: [
                                f.jsx('span', { className: 'text-white/80', children: i.name }),
                                f.jsxs('span', {
                                  className: 'text-white/40',
                                  children: [i.items, ' uds'],
                                }),
                                f.jsx('span', { className: 'text-white', children: i.total }),
                                f.jsx('span', { className: i.statusColor, children: i.status }),
                                f.jsx('span', { className: 'text-white/30', children: i.time }),
                              ],
                            },
                            i.name
                          )
                        ),
                      ],
                    }),
                  }),
                ],
              }),
            }),
            f.jsx('div', {
              ref: n,
              className: 'grid grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3',
              children: HP.map((i) =>
                f.jsxs(
                  'div',
                  {
                    className:
                      'highlight-card rounded-xl border border-white/[0.06] p-4 md:p-5 transition-colors hover:bg-white/[0.03]',
                    style: { background: 'rgba(255,255,255,0.02)' },
                    children: [
                      f.jsx('div', {
                        className:
                          'w-9 h-9 rounded-lg bg-orange-500/10 flex items-center justify-center mb-3',
                        children: f.jsx(i.icon, { className: 'w-4.5 h-4.5 text-orange-400' }),
                      }),
                      f.jsx('h3', {
                        className: 'text-sm font-medium text-foreground mb-1.5',
                        children: i.title,
                      }),
                      f.jsx('p', {
                        className: 'text-foreground/50 text-xs leading-relaxed',
                        children: i.desc,
                      }),
                    ],
                  },
                  i.title
                )
              ),
            }),
          ],
        }),
      })
    );
  };
ne.registerPlugin(oe);
const S_ = [
    {
      user: '@cryptomanu',
      text: 'Me cambio la forma de operar. Es rapido, limpio y mucho mas claro que otras herramientas.',
    },
    {
      user: '@blockdanny',
      text: 'Las alertas predictivas me evitaron perder un salto del 15%. Un antes y un despues.',
    },
    {
      user: '@eth_eli',
      text: 'Entre por el seguimiento de precios y me quede por los dashboards y alertas.',
    },
    {
      user: '@ethkaren',
      text: 'Me encanta el acceso desde cualquier dispositivo. Trabajo en desktop y sigo todo desde el celular.',
    },
    {
      user: '@devtraderjoe',
      text: 'Integre la API en mi propio panel y en minutos estaba funcionando. Documentacion excelente.',
    },
    {
      user: '@noirnode',
      text: 'La interfaz, el rendimiento y el feed en tiempo real son increibles.',
    },
    {
      user: '@btcbrenda',
      text: 'Nexova simplifico por completo como monitoreo mi negocio. Los datos en tiempo real son muy precisos.',
    },
    {
      user: '@altcoinrookie',
      text: 'La informacion esta visualmente impecable. Incluso siendo principiante, todo se entiende.',
    },
    {
      user: '@uxonchain',
      text: 'Es la primera plataforma que se siente hecha por gente de producto y operaciones reales.',
    },
    {
      user: '@codetheblock',
      text: 'Perfecta para equipos tecnicos. La API fue facil de integrar a nuestras herramientas.',
    },
    {
      user: '@fifi.rfqh',
      text: 'Antes tenia varias pestañas abiertas para seguir todo. Ahora lo tengo centralizado en un solo lugar.',
    },
    {
      user: '@signalhunter',
      text: 'Poder monitorear todo desde una sola pantalla me ahorro mucho tiempo todos los dias.',
    },
    {
      user: '@codecrusher',
      text: 'Como dev, esto es oro: rapido, bien documentado y simple de integrar.',
    },
    {
      user: '@defidiego',
      text: 'Antes dependia de varias apps. Ahora opero con una sola plataforma.',
    },
    {
      user: '@lunalurker',
      text: 'No soy trader profesional, pero con Nexova tomo mejores decisiones. La IA me ayudo a evitar caidas fuertes.',
    },
  ],
  YP = S_.slice(0, 8),
  XP = S_.slice(8),
  $v = [
    'bg-orange-600',
    'bg-blue-500',
    'bg-emerald-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-cyan-500',
    'bg-yellow-500',
    'bg-red-500',
    'bg-indigo-500',
    'bg-teal-500',
    'bg-violet-500',
    'bg-amber-500',
    'bg-lime-500',
    'bg-rose-500',
    'bg-sky-500',
  ];
function Bv({ t, idx: e }) {
  return f.jsxs('div', {
    className:
      'flex-shrink-0 w-[240px] sm:w-[280px] md:w-[320px] rounded-xl border border-white/[0.06] p-3 sm:p-4',
    style: { background: 'rgba(255,255,255,0.02)' },
    children: [
      f.jsxs('div', {
        className: 'flex items-center gap-2 mb-2',
        children: [
          f.jsx('div', {
            className: `w-6 h-6 rounded-full ${$v[e % $v.length]} flex items-center justify-center text-[8px] text-white font-bold`,
            children: t.user[1].toUpperCase(),
          }),
          f.jsx('span', { className: 'text-xs text-muted-foreground', children: t.user }),
        ],
      }),
      f.jsxs('p', {
        className: 'text-xs text-foreground/80 leading-relaxed',
        children: ['"', t.text, '"'],
      }),
    ],
  });
}
function Uv({ items: t, direction: e = 'left', duration: r = 40, offset: n = 0 }) {
  return f.jsxs('div', {
    className:
      'flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,white_8%,white_92%,transparent)]',
    children: [
      f.jsx('div', {
        className: 'flex gap-3 flex-shrink-0',
        style: { animation: `marquee-${e} ${r}s linear infinite`, animationDelay: `${n}s` },
        children: [...t, ...t].map((i, o) => f.jsx(Bv, { t: i, idx: o % t.length }, o)),
      }),
      f.jsx('div', {
        className: 'flex gap-3 flex-shrink-0',
        'aria-hidden': !0,
        style: { animation: `marquee-${e} ${r}s linear infinite`, animationDelay: `${n}s` },
        children: [...t, ...t].map((i, o) => f.jsx(Bv, { t: i, idx: o % t.length }, o)),
      }),
    ],
  });
}
function GP({ text: t, as: e = 'h2', className: r = '' }) {
  const n = b.useRef(null);
  b.useEffect(() => {
    if (!n.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = n.current.querySelectorAll('.wave-word'),
      s = ne.timeline({
        scrollTrigger: { trigger: n.current, start: 'top 90%', end: 'top 55%', scrub: 0.8 },
      });
    return (
      s.fromTo(
        o,
        { yPercent: 120, rotateX: 40, opacity: 0 },
        { yPercent: 0, rotateX: 0, opacity: 1, stagger: 0.06, duration: 1, ease: 'power3.out' }
      ),
      () => {
        var a;
        ((a = s.scrollTrigger) == null || a.kill(), s.kill());
      }
    );
  }, []);
  const i = e;
  return f.jsx(i, {
    ref: n,
    className: r,
    style: { perspective: '600px' },
    children: t
      .split(' ')
      .map((o, s) =>
        f.jsx(
          'span',
          {
            className: 'inline-block overflow-hidden align-bottom',
            children: f.jsxs('span', {
              className: 'wave-word inline-block will-change-transform',
              children: [o, ' '],
            }),
          },
          s
        )
      ),
  });
}
const QP = () => {
  const t = b.useRef(null);
  return (
    b.useEffect(() => {
      if (!t.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const e = ne.fromTo(
        t.current,
        { y: 30, opacity: 0, filter: 'blur(6px)' },
        {
          y: 0,
          opacity: 1,
          filter: 'blur(0px)',
          ease: 'none',
          scrollTrigger: { trigger: t.current, start: 'top 92%', end: 'top 65%', scrub: 0.8 },
        }
      );
      return () => {
        var r;
        ((r = e.scrollTrigger) == null || r.kill(), e.kill());
      };
    }, []),
    f.jsxs('section', {
      className: 'w-full py-16 md:py-20 overflow-hidden',
      children: [
        f.jsxs('div', {
          className: 'text-center mb-10 md:mb-12 px-4',
          children: [
            f.jsx(GP, {
              text: 'Confiado por miles de usuarios',
              as: 'h2',
              className: 'text-2xl md:text-3xl font-medium text-foreground mb-3',
            }),
            f.jsx('p', {
              ref: t,
              className: 'text-foreground/60 text-sm md:text-base max-w-lg mx-auto',
              children:
                'Sumate a equipos y negocios que usan Nexova para tomar decisiones con datos en tiempo real y analitica avanzada.',
            }),
          ],
        }),
        f.jsxs('div', {
          className: 'flex flex-col gap-3',
          children: [
            f.jsx(Uv, { items: YP, direction: 'left', duration: 90 }),
            f.jsx(Uv, { items: XP, direction: 'right', duration: 100 }),
          ],
        }),
      ],
    })
  );
};
function Lf(t, e, r) {
  return Math.min(r, Math.max(e, t));
}
function Vv(t, e, r) {
  const n = t.createShader(e);
  return n
    ? (t.shaderSource(n, r),
      t.compileShader(n),
      t.getShaderParameter(n, t.COMPILE_STATUS) ? n : (t.deleteShader(n), null))
    : null;
}
function KP(t, e, r) {
  const n = Vv(t, t.VERTEX_SHADER, e),
    i = Vv(t, t.FRAGMENT_SHADER, r);
  if (!n || !i) return (n && t.deleteShader(n), i && t.deleteShader(i), null);
  const o = t.createProgram();
  return o
    ? (t.attachShader(o, n),
      t.attachShader(o, i),
      t.linkProgram(o),
      t.deleteShader(n),
      t.deleteShader(i),
      t.getProgramParameter(o, t.LINK_STATUS) ? o : (t.deleteProgram(o), null))
    : (t.deleteShader(n), t.deleteShader(i), null);
}
const ZP = `
  attribute vec2 aPosition;
  void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`,
  JP = `
  precision mediump float;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uSeed;
  uniform vec2  uMouse;
  uniform vec2  uMouseGhost;
  uniform float uMouseEnergy;

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution.xy;
    float t  = uTime * 0.35 + uSeed * 6.2832;
    float ar = uResolution.x / uResolution.y;

    vec2 wuv = uv + vec2(
      0.05 * sin(uv.y * 3.8 + t * 0.3) + 0.03 * cos(uv.x * 2.8 + t * 0.22),
      0.05 * cos(uv.x * 4.0 - t * 0.26) + 0.03 * sin(uv.y * 3.2 + t * 0.35)
    );

    float mDist = length(uv - uMouse);
    vec2  mDir  = (uv - uMouse) / (mDist + 0.001);
    float push  = uMouseEnergy * 0.03 * exp(-mDist * mDist / 0.04);
    wuv += mDir * push;

    vec2 ap = vec2(ar, 1.0);

    vec2 q0 = vec2(0.10 + 0.22*sin(t*0.65),        0.85 + 0.18*cos(t*0.48));
    vec2 q1 = vec2(0.50 + 0.30*cos(t*0.40),        0.62 + 0.25*sin(t*0.55));
    vec2 q2 = vec2(0.88 + 0.18*sin(t*0.52),        0.38 + 0.26*cos(t*0.42));
    vec2 q3 = vec2(0.22 + 0.27*cos(t*0.35 + 1.2),  0.15 + 0.23*sin(t*0.60));
    vec2 q4 = vec2(0.72 + 0.25*sin(t*0.46 + 2.1),  0.12 + 0.20*cos(t*0.52));
    vec2 q5 = vec2(0.08 + 0.17*cos(t*0.57 + 0.8),  0.50 + 0.28*sin(t*0.38));
    vec2 q6 = vec2(0.60 + 0.23*sin(t*0.42 + 3.0),  0.86 + 0.19*cos(t*0.32));
    vec2 q7 = vec2(0.35 + 0.26*cos(t*0.30 + 1.8),  0.44 + 0.24*sin(t*0.50));

    /* Very dark palette — deep blues, indigos, near-blacks */
    vec3 col0 = vec3(0.012, 0.012, 0.035);
    vec3 col1 = vec3(0.04,  0.03,  0.11);
    vec3 col2 = vec3(0.018, 0.015, 0.055);
    vec3 col3 = vec3(0.06,  0.04,  0.15);
    vec3 col4 = vec3(0.03,  0.025, 0.09);
    vec3 col5 = vec3(0.014, 0.012, 0.04);
    vec3 col6 = vec3(0.05,  0.04,  0.13);
    vec3 col7 = vec3(0.022, 0.018, 0.065);

    float EPS = 0.000035;
    float d0 = length((wuv-q0)*ap); float w0 = 1.0/(d0*d0*d0*d0+EPS);
    float d1 = length((wuv-q1)*ap); float w1 = 1.0/(d1*d1*d1*d1+EPS);
    float d2 = length((wuv-q2)*ap); float w2 = 1.0/(d2*d2*d2*d2+EPS);
    float d3 = length((wuv-q3)*ap); float w3 = 1.0/(d3*d3*d3*d3+EPS);
    float d4 = length((wuv-q4)*ap); float w4 = 1.0/(d4*d4*d4*d4+EPS);
    float d5 = length((wuv-q5)*ap); float w5 = 1.0/(d5*d5*d5*d5+EPS);
    float d6 = length((wuv-q6)*ap); float w6 = 1.0/(d6*d6*d6*d6+EPS);
    float d7 = length((wuv-q7)*ap); float w7 = 1.0/(d7*d7*d7*d7+EPS);

    float tw = w0+w1+w2+w3+w4+w5+w6+w7;
    vec3 color = (col0*w0+col1*w1+col2*w2+col3*w3+
                  col4*w4+col5*w5+col6*w6+col7*w7) / tw;

    /* Subtle indigo trail */
    vec2  seg    = uMouse - uMouseGhost;
    float segLen = length(seg);
    float speed  = smoothstep(0.0, 0.12, segLen);
    vec2  segN   = seg / (segLen + 0.0001);
    float proj   = clamp(dot(uv - uMouseGhost, segN), 0.0, segLen);
    vec2  clos   = uMouseGhost + segN * proj;
    float tDist  = length(uv - clos);
    float tWidth = 0.014 + speed * 0.018;
    float trail  = uMouseEnergy * speed * exp(-(tDist*tDist)/(tWidth*tWidth));
    color += vec3(0.12, 0.10, 0.30) * trail * 0.3;

    /* Subtle indigo glow */
    float glow = uMouseEnergy * 0.18 * exp(-mDist * mDist / 0.008);
    color += vec3(0.18, 0.14, 0.45) * glow;

    /* Vignette */
    vec2  vc  = uv * 2.0 - 1.0;
    float vig = smoothstep(1.6, 0.4, length(vc));
    color *= mix(0.85, 1.0, vig);

    gl_FragColor = vec4(color, 1.0);
  }
`;
function eN({ className: t = '', seed: e = 0 }) {
  const r = b.useRef(null);
  return (
    b.useEffect(() => {
      const n = r.current;
      if (!n || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const i = n.getContext('webgl', {
        alpha: !1,
        antialias: !1,
        depth: !1,
        stencil: !1,
        preserveDrawingBuffer: !1,
      });
      if (!i) return;
      const o = KP(i, ZP, JP);
      if (!o) return;
      const s = i.createBuffer();
      if (!s) {
        i.deleteProgram(o);
        return;
      }
      (i.bindBuffer(i.ARRAY_BUFFER, s),
        i.bufferData(
          i.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          i.STATIC_DRAW
        ));
      const a = i.getAttribLocation(o, 'aPosition'),
        l = i.getUniformLocation(o, 'uResolution'),
        u = i.getUniformLocation(o, 'uTime'),
        c = i.getUniformLocation(o, 'uSeed'),
        p = i.getUniformLocation(o, 'uMouse'),
        h = i.getUniformLocation(o, 'uMouseGhost'),
        d = i.getUniformLocation(o, 'uMouseEnergy'),
        y = { x: 0.5, y: 0.5 },
        m = { x: 0.5, y: 0.5 },
        x = { x: 0.5, y: 0.5 };
      let v = 0,
        g = performance.now();
      const w = (T) => {
          const P = n.getBoundingClientRect();
          !P.width ||
            !P.height ||
            T.clientX < P.left ||
            T.clientX > P.right ||
            T.clientY < P.top ||
            T.clientY > P.bottom ||
            ((y.x = Lf((T.clientX - P.left) / P.width, 0, 1)),
            (y.y = Lf(1 - (T.clientY - P.top) / P.height, 0, 1)),
            (v += (1 - v) * 0.05),
            (g = performance.now()));
        },
        _ = () => {
          const T = n.parentElement;
          if (!T) return;
          const P = Math.min(window.devicePixelRatio || 1, 1.5),
            N = Math.max(1, Math.floor(T.clientWidth * P)),
            D = Math.max(1, Math.floor(T.clientHeight * P));
          (n.width !== N || n.height !== D) && ((n.width = N), (n.height = D));
        },
        S = performance.now();
      let C = 0;
      const k = (T) => {
        (_(),
          T - g > 200 && (v *= 0.993),
          (m.x += (y.x - m.x) * 0.14),
          (m.y += (y.y - m.y) * 0.14),
          (x.x += (m.x - x.x) * 0.04),
          (x.y += (m.y - x.y) * 0.04),
          i.viewport(0, 0, n.width, n.height),
          i.useProgram(o),
          i.bindBuffer(i.ARRAY_BUFFER, s),
          i.enableVertexAttribArray(a),
          i.vertexAttribPointer(a, 2, i.FLOAT, !1, 0, 0),
          i.uniform2f(l, n.width, n.height),
          i.uniform1f(u, (T - S) * 0.001),
          i.uniform1f(c, e),
          i.uniform2f(p, m.x, m.y),
          i.uniform2f(h, x.x, x.y),
          i.uniform1f(d, Lf(v, 0, 1)),
          i.drawArrays(i.TRIANGLE_STRIP, 0, 4),
          (C = requestAnimationFrame(k)));
      };
      return (
        window.addEventListener('pointermove', w, { passive: !0 }),
        window.addEventListener('resize', _),
        _(),
        (C = requestAnimationFrame(k)),
        () => {
          (cancelAnimationFrame(C),
            window.removeEventListener('pointermove', w),
            window.removeEventListener('resize', _),
            i.deleteBuffer(s),
            i.deleteProgram(o));
        }
      );
    }, [e]),
    f.jsx('div', {
      className: `overflow-hidden ${t}`,
      style: {
        background: 'linear-gradient(135deg, #020210 0%, #06061a 40%, #0a0a28 70%, #050518 100%)',
      },
      'aria-hidden': !0,
      children: f.jsx('canvas', {
        ref: r,
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' },
      }),
    })
  );
}
ne.registerPlugin(oe);
const tN = [
  {
    slug: 'basic',
    name: 'Plan Inicial',
    description: 'Ideal para empezar a vender y gestionar tu operación diaria.',
    price: '$75.000',
    billing: 'Por mes / facturación mensual en ARS',
    checkoutUrl: '/checkout/?plan=basic',
    featured: !1,
    iconColor: 'text-zinc-400',
    features: [
      'Acceso a la plataforma',
      'Pestaña Inbox',
      'Conexión al bot',
      'Catálogo base',
      'Envío de boleta en formato base',
      'Asistente IA',
    ],
  },
  {
    slug: 'standard',
    name: 'Plan Pro',
    description: 'Para negocios que quieren automatizar, facturar y crecer más rápido.',
    price: '$150.000',
    billing: 'Por mes / facturación mensual en ARS',
    checkoutUrl: '/checkout/?plan=standard',
    featured: !0,
    iconColor: 'text-yellow-500',
    features: [
      'Todo lo del Plan Inicial',
      'Lectura de comprobantes por bot',
      'Envío de promociones y campañas',
      'Catálogo personalizado',
      'Conexión a Mercado Pago',
      'Módulo de facturación',
      'Template de boleta personalizado',
    ],
  },
  {
    slug: 'pro',
    name: 'Plan Empresa',
    description: 'Para operaciones avanzadas que necesitan control total y respuesta inmediata.',
    price: '$200.000',
    billing: 'Por mes / facturación mensual en ARS',
    checkoutUrl: '/checkout/?plan=pro',
    featured: !1,
    iconColor: 'text-orange-500',
    features: [
      'Todo lo del Plan Pro',
      'Sistema de acciones rápidas',
      'Notificaciones por WhatsApp al dueño',
      'Consultas del dueño por WhatsApp en vivo',
    ],
  },
];
function rN({ text: t, as: e = 'h2', className: r = '' }) {
  const n = b.useRef(null);
  b.useEffect(() => {
    if (!n.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = n.current.querySelectorAll('.wave-word'),
      s = ne.timeline({
        scrollTrigger: { trigger: n.current, start: 'top 90%', end: 'top 55%', scrub: 0.8 },
      });
    return (
      s.fromTo(
        o,
        { yPercent: 120, rotateX: 40, opacity: 0 },
        { yPercent: 0, rotateX: 0, opacity: 1, stagger: 0.06, duration: 1, ease: 'power3.out' }
      ),
      () => {
        var a;
        ((a = s.scrollTrigger) == null || a.kill(), s.kill());
      }
    );
  }, []);
  const i = e;
  return f.jsx(i, {
    ref: n,
    className: r,
    style: { perspective: '600px' },
    children: t
      .split(' ')
      .map((o, s) =>
        f.jsx(
          'span',
          {
            className: 'inline-block overflow-hidden align-bottom',
            children: f.jsxs('span', {
              className: 'wave-word inline-block will-change-transform',
              children: [o, ' '],
            }),
          },
          s
        )
      ),
  });
}
const nN = () => {
  const t = b.useRef(null),
    e = b.useRef(null),
    r = b.useRef(null);
  return (
    b.useEffect(() => {
      if (!t.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const n = ne.context(() => {
        var o;
        ne.fromTo(
          e.current,
          { y: 30, opacity: 0, filter: 'blur(6px)' },
          {
            y: 0,
            opacity: 1,
            filter: 'blur(0px)',
            ease: 'none',
            scrollTrigger: { trigger: e.current, start: 'top 92%', end: 'top 65%', scrub: 0.8 },
          }
        );
        const i = (o = r.current) == null ? void 0 : o.querySelectorAll('.pricing-card');
        i != null &&
          i.length &&
          ne
            .timeline({
              scrollTrigger: { trigger: r.current, start: 'top 85%', end: 'top 35%', scrub: 0.8 },
            })
            .fromTo(
              i,
              { y: 100, opacity: 0, scale: 0.92 },
              { y: 0, opacity: 1, scale: 1, stagger: 0.12, duration: 1, ease: 'power2.out' }
            );
      }, t);
      return () => n.revert();
    }, []),
    f.jsxs('section', {
      id: 'precios',
      ref: t,
      className: 'w-full py-16 md:py-20 px-4 md:px-6 lg:px-8 relative overflow-hidden',
      children: [
        f.jsx(eN, { className: 'absolute inset-0', seed: 0.42 }),
        f.jsx('div', {
          className: 'absolute inset-x-0 top-0 h-32 pointer-events-none z-[1]',
          style: { background: 'linear-gradient(to bottom, hsl(228 67% 1.2%), transparent)' },
        }),
        f.jsx('div', {
          className: 'absolute inset-x-0 bottom-0 h-32 pointer-events-none z-[1]',
          style: { background: 'linear-gradient(to top, hsl(228 67% 1.2%), transparent)' },
        }),
        f.jsxs('div', {
          className: 'max-w-[900px] mx-auto relative z-10',
          children: [
            f.jsxs('div', {
              className: 'text-center mb-12',
              children: [
                f.jsx(rN, {
                  text: 'Elegí el plan ideal para tu negocio',
                  as: 'h2',
                  className: 'text-2xl md:text-3xl font-medium text-foreground mb-3',
                }),
                f.jsx('p', {
                  ref: e,
                  className: 'text-muted-foreground text-sm max-w-lg mx-auto',
                  children:
                    'Desde la operación base hasta la gestión avanzada con IA, nuestros planes se adaptan al ritmo de crecimiento de tu negocio.',
                }),
              ],
            }),
            f.jsx('div', {
              ref: r,
              className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',
              children: tN.map((n) =>
                f.jsxs(
                  'div',
                  {
                    className:
                      'pricing-card relative rounded-2xl border border-white/10 p-5 flex flex-col backdrop-blur-xl',
                    style: {
                      background: n.featured
                        ? 'linear-gradient(180deg, rgba(30,30,80,0.6) 0%, rgba(15,15,50,0.4) 50%, rgba(8,8,24,0.3) 100%)'
                        : 'rgba(255,255,255,0.03)',
                      boxShadow:
                        '0 0 40px inset rgba(255,255,255,0.03), 0 0 20px inset rgba(255,255,255,0.02)',
                    },
                    children: [
                      f.jsx(ik, { className: `w-6 h-6 mb-3 ${n.iconColor}` }),
                      f.jsx('h3', {
                        className: 'text-base font-medium text-foreground mb-1',
                        children: n.name,
                      }),
                      f.jsx('p', {
                        className: 'text-foreground/60 text-xs mb-4',
                        children: n.description,
                      }),
                      f.jsxs('div', {
                        className: 'mb-4',
                        children: [
                          f.jsx('span', {
                            className: 'text-3xl font-medium text-foreground',
                            children: n.price,
                          }),
                          f.jsx('p', {
                            className: 'text-foreground/60 text-xs mt-1',
                            children: n.billing,
                          }),
                        ],
                      }),
                      f.jsx('div', { className: 'w-full h-px bg-white/10 mb-4' }),
                      f.jsx('ul', {
                        className: 'space-y-2 mb-6 flex-1',
                        children: n.features.map((i) =>
                          f.jsxs(
                            'li',
                            {
                              className: 'flex items-center gap-2 text-xs text-foreground/80',
                              children: [
                                f.jsx(ek, {
                                  className: 'w-3.5 h-3.5 text-foreground/60 flex-shrink-0',
                                }),
                                f.jsx('span', { children: i }),
                              ],
                            },
                            i
                          )
                        ),
                      }),
                      n.featured
                        ? f.jsxs('a', {
                            href: n.checkoutUrl,
                            className: 'sparkle-btn w-full justify-center',
                            children: [
                              f.jsx('div', { className: 'dots_border' }),
                              f.jsxs('svg', {
                                xmlns: 'http://www.w3.org/2000/svg',
                                fill: 'none',
                                viewBox: '0 0 24 24',
                                className: 'sparkle-icon',
                                children: [
                                  f.jsx('path', {
                                    className: 'sparkle-path',
                                    strokeLinejoin: 'round',
                                    strokeLinecap: 'round',
                                    stroke: 'black',
                                    fill: 'black',
                                    d: 'M14.187 8.096L15 5.25L15.813 8.096C16.0231 8.83114 16.4171 9.50062 16.9577 10.0413C17.4984 10.5819 18.1679 10.9759 18.903 11.186L21.75 12L18.904 12.813C18.1689 13.0231 17.4994 13.4171 16.9587 13.9577C16.4181 14.4984 16.0241 15.1679 15.814 15.903L15 18.75L14.187 15.904C13.9769 15.1689 13.5829 14.4994 13.0423 13.9587C12.5016 13.4181 11.8321 13.0241 11.097 12.814L8.25 12L11.096 11.187C11.8311 10.9769 12.5006 10.5829 13.0413 10.0423C13.5819 9.50162 13.9759 8.83214 14.186 8.097L14.187 8.096Z',
                                  }),
                                  f.jsx('path', {
                                    className: 'sparkle-path',
                                    strokeLinejoin: 'round',
                                    strokeLinecap: 'round',
                                    stroke: 'black',
                                    fill: 'black',
                                    d: 'M6 14.25L5.741 15.285C5.59267 15.8785 5.28579 16.4206 4.85319 16.8532C4.42059 17.2858 3.87853 17.5927 3.285 17.741L2.25 18L3.285 18.259C3.87853 18.4073 4.42059 18.7142 4.85319 19.1468C5.28579 19.5794 5.59267 20.1215 5.741 20.715L6 21.75L6.259 20.715C6.40725 20.1216 6.71398 19.5796 7.14639 19.147C7.5788 18.7144 8.12065 18.4075 8.714 18.259L9.75 18L8.714 17.741C8.12065 17.5925 7.5788 17.2856 7.14639 16.853C6.71398 16.4204 6.40725 15.8784 6.259 15.285L6 14.25Z',
                                  }),
                                  f.jsx('path', {
                                    className: 'sparkle-path',
                                    strokeLinejoin: 'round',
                                    strokeLinecap: 'round',
                                    stroke: 'black',
                                    fill: 'black',
                                    d: 'M6.5 4L6.303 4.5915C6.24777 4.75718 6.15472 4.90774 6.03123 5.03123C5.90774 5.15472 5.75718 5.24777 5.5915 5.303L5 5.5L5.5915 5.697C5.75718 5.75223 5.90774 5.84528 6.03123 5.96877C6.15472 6.09226 6.24777 6.24282 6.303 6.4085L6.5 7L6.697 6.4085C6.75223 6.24282 6.84528 6.09226 6.96877 5.96877C7.09226 5.84528 7.24282 5.75223 7.4085 5.697L8 5.5L7.4085 5.303C7.24282 5.24777 7.09226 5.15472 6.96877 5.03123C6.84528 4.90774 6.75223 4.75718 6.697 4.5915L6.5 4Z',
                                  }),
                                ],
                              }),
                              f.jsx('span', {
                                className: 'text_button',
                                children: 'Ir al checkout',
                              }),
                            ],
                          })
                        : f.jsx('a', {
                            href: n.checkoutUrl,
                            className:
                              'btn-radial w-full py-2.5 px-4 rounded-lg text-xs font-medium bg-white/10 text-foreground border border-white/10 text-center',
                            children: 'Ir al checkout',
                          }),
                    ],
                  },
                  n.slug
                )
              ),
            }),
          ],
        }),
      ],
    })
  );
};
ne.registerPlugin(oe);
const Df = [
    {
      q: 'Que es este servicio y para quien esta pensado?',
      a: 'Nexova es una plataforma integral para gestionar ventas, pedidos, stock, clientes y comunicacion en un solo lugar. Esta pensada para negocios y equipos que necesitan operar con datos en tiempo real.',
    },
    {
      q: 'Puedo usarlo desde celular y otros dispositivos?',
      a: 'Si. La plataforma es responsive y funciona en escritorio, tablet y movil, para que puedas seguir tu operacion desde cualquier lugar.',
    },
    {
      q: 'Como funciona la analitica?',
      a: 'Procesamos datos de tu negocio en tiempo real para mostrar tendencias, detectar oportunidades y ayudarte a tomar mejores decisiones con informacion clara.',
    },
    {
      q: 'Que pasa si cambio de plan?',
      a: 'Podes cambiar tu plan cuando quieras. El cambio se aplica al momento y se ajusta automaticamente la facturacion segun corresponda.',
    },
    {
      q: 'Como se sincroniza la informacion?',
      a: 'La plataforma se integra con tus canales y fuentes de datos mediante conexiones seguras, manteniendo la informacion actualizada en tiempo real.',
    },
    {
      q: 'Se pueden configurar notificaciones automaticas?',
      a: 'Si. Podes crear alertas personalizadas para ventas, pedidos, stock y eventos clave a traves de email, SMS o notificaciones push.',
    },
    {
      q: 'Mis datos estan protegidos?',
      a: 'Si. Usamos cifrado, autenticacion en dos pasos y protocolos de seguridad de nivel empresarial para proteger tu informacion.',
    },
    {
      q: 'Como obtengo soporte?',
      a: 'Nuestro equipo brinda soporte por chat y email. En planes avanzados tambien tenes atencion prioritaria y acompanamiento dedicado.',
    },
  ],
  Wv = ({ num: t, question: e, answer: r }) => {
    const [n, i] = b.useState(!1),
      o = b.useRef(null),
      s = b.useRef(null),
      a = b.useRef(null),
      l = b.useCallback(() => {
        const u = o.current,
          c = s.current,
          p = a.current;
        !u ||
          !c ||
          !p ||
          (n
            ? (ne.to(u, {
                height: 0,
                opacity: 0,
                duration: 0.35,
                ease: 'power2.inOut',
                onComplete: () => {
                  (i(!1), ne.set(u, { display: 'none' }));
                },
              }),
              ne.to(p, { rotate: 0, duration: 0.35, ease: 'power2.inOut' }))
            : (i(!0),
              ne.set(u, { display: 'block', height: 0, opacity: 0 }),
              ne.to(u, {
                height: c.offsetHeight,
                opacity: 1,
                duration: 0.4,
                ease: 'power2.out',
                onComplete: () => ne.set(u, { height: 'auto' }),
              }),
              ne.to(p, { rotate: 180, duration: 0.35, ease: 'power2.inOut' })));
      }, [n]);
    return f.jsxs('div', {
      className: 'faq-card rounded-lg border border-white/[0.06] overflow-hidden backdrop-blur-xl',
      style: { background: 'rgba(255,255,255,0.02)' },
      children: [
        f.jsxs('button', {
          onClick: l,
          className:
            'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03]',
          children: [
            f.jsxs('div', {
              className: 'flex items-center gap-3 min-w-0',
              children: [
                f.jsx('span', {
                  className: 'text-foreground/20 text-[10px] font-mono flex-shrink-0',
                  children: t,
                }),
                f.jsx('span', {
                  className: 'text-foreground font-medium text-xs leading-relaxed',
                  children: e,
                }),
              ],
            }),
            f.jsx('div', {
              ref: a,
              className: 'flex-shrink-0',
              children: f.jsx(tk, { className: 'w-3.5 h-3.5 text-foreground/40' }),
            }),
          ],
        }),
        f.jsx('div', {
          ref: o,
          style: { display: 'none', overflow: 'hidden' },
          children: f.jsx('div', {
            ref: s,
            className: 'px-4 pt-1 pb-5 pl-[52px]',
            children: f.jsx('p', {
              className: 'text-foreground/50 text-xs leading-relaxed',
              children: r,
            }),
          }),
        }),
      ],
    });
  };
function iN({ text: t, as: e = 'h2', className: r = '' }) {
  const n = b.useRef(null);
  b.useEffect(() => {
    if (!n.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = n.current.querySelectorAll('.wave-word'),
      s = ne.timeline({
        scrollTrigger: { trigger: n.current, start: 'top 90%', end: 'top 55%', scrub: 0.8 },
      });
    return (
      s.fromTo(
        o,
        { yPercent: 120, rotateX: 40, opacity: 0 },
        { yPercent: 0, rotateX: 0, opacity: 1, stagger: 0.06, duration: 1, ease: 'power3.out' }
      ),
      () => {
        var a;
        ((a = s.scrollTrigger) == null || a.kill(), s.kill());
      }
    );
  }, []);
  const i = e;
  return f.jsx(i, {
    ref: n,
    className: r,
    style: { perspective: '600px' },
    children: t
      .split(' ')
      .map((o, s) =>
        f.jsx(
          'span',
          {
            className: 'inline-block overflow-hidden align-bottom',
            children: f.jsxs('span', {
              className: 'wave-word inline-block will-change-transform',
              children: [o, ' '],
            }),
          },
          s
        )
      ),
  });
}
const oN = () => {
  const t = b.useRef(null),
    e = b.useRef(null),
    r = Math.ceil(Df.length / 2),
    n = Df.slice(0, r),
    i = Df.slice(r);
  return (
    b.useEffect(() => {
      if (!t.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const o = ne.context(() => {
        var a;
        const s = (a = e.current) == null ? void 0 : a.querySelectorAll('.faq-card');
        s != null &&
          s.length &&
          ne
            .timeline({
              scrollTrigger: { trigger: e.current, start: 'top 88%', end: 'top 35%', scrub: 0.8 },
            })
            .fromTo(
              s,
              { y: 60, opacity: 0 },
              { y: 0, opacity: 1, stagger: 0.06, duration: 1, ease: 'power2.out' }
            );
      }, t);
      return () => o.revert();
    }, []),
    f.jsx('section', {
      id: 'faq',
      ref: t,
      className: 'w-full py-16 md:py-20 px-4 md:px-6 lg:px-8',
      children: f.jsxs('div', {
        className: 'max-w-[900px] mx-auto',
        children: [
          f.jsx('div', {
            className: 'text-center mb-10',
            children: f.jsx(iN, {
              text: 'Todo lo que necesitas saber sobre planes, funcionalidades y seguridad',
              as: 'h2',
              className: 'text-2xl md:text-3xl font-medium text-foreground mb-3',
            }),
          }),
          f.jsxs('div', {
            ref: e,
            className: 'grid grid-cols-1 md:grid-cols-2 gap-2.5',
            children: [
              f.jsx('div', {
                className: 'space-y-2.5',
                children: n.map((o, s) =>
                  f.jsx(Wv, { num: String(s + 1).padStart(2, '0'), question: o.q, answer: o.a }, s)
                ),
              }),
              f.jsx('div', {
                className: 'space-y-2.5',
                children: i.map((o, s) =>
                  f.jsx(
                    Wv,
                    { num: String(r + s + 1).padStart(2, '0'), question: o.q, answer: o.a },
                    s
                  )
                ),
              }),
            ],
          }),
        ],
      }),
    })
  );
};
ne.registerPlugin(oe);
const sN = [
  { top: '10%', left: '5%', size: 1.5 },
  { top: '15%', left: '92%', size: 2 },
  { top: '25%', left: '18%', size: 1 },
  { top: '8%', left: '75%', size: 1.5 },
  { top: '35%', left: '8%', size: 2 },
  { top: '20%', left: '65%', size: 1 },
  { top: '12%', left: '45%', size: 1.5 },
  { top: '40%', left: '88%', size: 2 },
  { top: '18%', left: '35%', size: 1 },
  { top: '30%', left: '95%', size: 1.5 },
  { top: '22%', left: '3%', size: 2 },
  { top: '45%', left: '72%', size: 1 },
  { top: '5%', left: '58%', size: 1.5 },
  { top: '38%', left: '28%', size: 2 },
  { top: '28%', left: '82%', size: 1 },
  { top: '50%', left: '15%', size: 1.5 },
  { top: '7%', left: '22%', size: 2 },
  { top: '42%', left: '55%', size: 1 },
  { top: '32%', left: '48%', size: 1.5 },
  { top: '16%', left: '12%', size: 2 },
  { top: '6%', left: '38%', size: 1 },
  { top: '33%', left: '62%', size: 1.5 },
  { top: '48%', left: '25%', size: 2 },
  { top: '14%', left: '80%', size: 1 },
  { top: '26%', left: '42%', size: 1.5 },
  { top: '44%', left: '10%', size: 2 },
  { top: '9%', left: '68%', size: 1 },
  { top: '36%', left: '98%', size: 1.5 },
  { top: '52%', left: '52%', size: 2 },
  { top: '19%', left: '30%', size: 1 },
];
function aN({ text: t, as: e = 'h2', className: r = '' }) {
  const n = b.useRef(null);
  b.useEffect(() => {
    if (!n.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const o = n.current.querySelectorAll('.wave-word'),
      s = ne.timeline({
        scrollTrigger: { trigger: n.current, start: 'top 90%', end: 'top 55%', scrub: 0.8 },
      });
    return (
      s.fromTo(
        o,
        { yPercent: 120, rotateX: 40, opacity: 0 },
        { yPercent: 0, rotateX: 0, opacity: 1, stagger: 0.06, duration: 1, ease: 'power3.out' }
      ),
      () => {
        var a;
        ((a = s.scrollTrigger) == null || a.kill(), s.kill());
      }
    );
  }, []);
  const i = e;
  return f.jsx(i, {
    ref: n,
    className: r,
    style: { perspective: '600px' },
    children: t
      .split(' ')
      .map((o, s) =>
        f.jsx(
          'span',
          {
            className: 'inline-block overflow-hidden align-bottom',
            children: f.jsxs('span', {
              className: 'wave-word inline-block will-change-transform',
              children: [o, ' '],
            }),
          },
          s
        )
      ),
  });
}
const lN = () => {
    const t = b.useRef(null),
      e = b.useRef(null),
      r = b.useRef(null),
      n = b.useRef(null);
    return (
      b.useEffect(() => {
        if (!t.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const i = ne.context(() => {
          (ne.fromTo(
            e.current,
            { scale: 0.5, opacity: 0 },
            {
              scale: 1,
              opacity: 1,
              ease: 'none',
              scrollTrigger: { trigger: e.current, start: 'top 92%', end: 'top 70%', scrub: 0.8 },
            }
          ),
            ne.fromTo(
              r.current,
              { y: 30, opacity: 0, filter: 'blur(6px)' },
              {
                y: 0,
                opacity: 1,
                filter: 'blur(0px)',
                ease: 'none',
                scrollTrigger: { trigger: r.current, start: 'top 92%', end: 'top 65%', scrub: 0.8 },
              }
            ),
            ne.fromTo(
              n.current,
              { y: 25, opacity: 0 },
              {
                y: 0,
                opacity: 1,
                ease: 'none',
                scrollTrigger: { trigger: n.current, start: 'top 95%', end: 'top 72%', scrub: 0.8 },
              }
            ));
        }, t);
        return () => i.revert();
      }, []),
      f.jsx('section', {
        id: 'contacto',
        ref: t,
        className: 'w-full py-16 md:py-20 px-4 md:px-6 lg:px-8',
        children: f.jsx('div', {
          className: 'max-w-[900px] mx-auto',
          children: f.jsxs('div', {
            className: 'rounded-[20px] md:rounded-[28px] relative overflow-hidden',
            children: [
              f.jsx(b_, { className: 'absolute inset-0', seed: 0.77 }),
              f.jsx('div', {
                className: 'absolute inset-0 pointer-events-none z-[1]',
                style: {
                  background: `
                linear-gradient(to bottom, hsl(228 67% 1.2%) 0%, hsl(228 67% 1.2% / 0.85) 15%, hsl(228 67% 1.2% / 0.4) 35%, transparent 55%),
                linear-gradient(to top, hsl(228 67% 1.2%) 0%, hsl(228 67% 1.2% / 0.85) 15%, hsl(228 67% 1.2% / 0.4) 35%, transparent 55%),
                linear-gradient(to right, hsl(228 67% 1.2%) 0%, transparent 20%),
                linear-gradient(to left, hsl(228 67% 1.2%) 0%, transparent 20%)
              `,
                },
              }),
              f.jsx('div', {
                className: 'absolute inset-0 overflow-hidden pointer-events-none z-[2]',
                children: sN.map((i, o) =>
                  f.jsx(
                    'div',
                    {
                      className: 'absolute rounded-full bg-white',
                      style: {
                        top: i.top,
                        left: i.left,
                        width: `${i.size}px`,
                        height: `${i.size}px`,
                        opacity: 0.5,
                      },
                    },
                    o
                  )
                ),
              }),
              f.jsxs('div', {
                className:
                  'relative z-10 flex flex-col items-center text-center py-12 md:py-16 px-4 md:px-6',
                children: [
                  f.jsx('div', {
                    ref: e,
                    className: 'mb-5',
                    children: f.jsx('img', {
                      src: '/brand/logo-dark.svg',
                      alt: 'Nexova',
                      className: 'h-6 md:h-7 w-auto mx-auto',
                    }),
                  }),
                  f.jsx(aN, {
                    text: 'Listo para empezar?',
                    as: 'h2',
                    className: 'text-2xl md:text-3xl font-medium text-foreground mb-3',
                  }),
                  f.jsx('p', {
                    ref: r,
                    className: 'text-foreground/60 text-sm max-w-md mb-6 leading-relaxed',
                    children:
                      'Contactanos para una demo personalizada o empeza tu prueba y descubri como escalar tu operacion con Nexova.',
                  }),
                  f.jsxs('a', {
                    ref: n,
                    href: '/checkout',
                    className: 'sparkle-btn',
                    children: [
                      f.jsx('div', { className: 'dots_border' }),
                      f.jsxs('svg', {
                        xmlns: 'http://www.w3.org/2000/svg',
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        className: 'sparkle-icon',
                        children: [
                          f.jsx('path', {
                            className: 'sparkle-path',
                            strokeLinejoin: 'round',
                            strokeLinecap: 'round',
                            stroke: 'black',
                            fill: 'black',
                            d: 'M14.187 8.096L15 5.25L15.813 8.096C16.0231 8.83114 16.4171 9.50062 16.9577 10.0413C17.4984 10.5819 18.1679 10.9759 18.903 11.186L21.75 12L18.904 12.813C18.1689 13.0231 17.4994 13.4171 16.9587 13.9577C16.4181 14.4984 16.0241 15.1679 15.814 15.903L15 18.75L14.187 15.904C13.9769 15.1689 13.5829 14.4994 13.0423 13.9587C12.5016 13.4181 11.8321 13.0241 11.097 12.814L8.25 12L11.096 11.187C11.8311 10.9769 12.5006 10.5829 13.0413 10.0423C13.5819 9.50162 13.9759 8.83214 14.186 8.097L14.187 8.096Z',
                          }),
                          f.jsx('path', {
                            className: 'sparkle-path',
                            strokeLinejoin: 'round',
                            strokeLinecap: 'round',
                            stroke: 'black',
                            fill: 'black',
                            d: 'M6 14.25L5.741 15.285C5.59267 15.8785 5.28579 16.4206 4.85319 16.8532C4.42059 17.2858 3.87853 17.5927 3.285 17.741L2.25 18L3.285 18.259C3.87853 18.4073 4.42059 18.7142 4.85319 19.1468C5.28579 19.5794 5.59267 20.1215 5.741 20.715L6 21.75L6.259 20.715C6.40725 20.1216 6.71398 19.5796 7.14639 19.147C7.5788 18.7144 8.12065 18.4075 8.714 18.259L9.75 18L8.714 17.741C8.12065 17.5925 7.5788 17.2856 7.14639 16.853C6.71398 16.4204 6.40725 15.8784 6.259 15.285L6 14.25Z',
                          }),
                          f.jsx('path', {
                            className: 'sparkle-path',
                            strokeLinejoin: 'round',
                            strokeLinecap: 'round',
                            stroke: 'black',
                            fill: 'black',
                            d: 'M6.5 4L6.303 4.5915C6.24777 4.75718 6.15472 4.90774 6.03123 5.03123C5.90774 5.15472 5.75718 5.24777 5.5915 5.303L5 5.5L5.5915 5.697C5.75718 5.75223 5.90774 5.84528 6.03123 5.96877C6.15472 6.09226 6.24777 6.24282 6.303 6.4085L6.5 7L6.697 6.4085C6.75223 6.24282 6.84528 6.09226 6.96877 5.96877C7.09226 5.84528 7.24282 5.75223 7.4085 5.697L8 5.5L7.4085 5.303C7.24282 5.24777 7.09226 5.15472 6.96877 5.03123C6.84528 4.90774 6.75223 4.75718 6.697 4.5915L6.5 4Z',
                          }),
                        ],
                      }),
                      f.jsx('span', { className: 'text_button', children: 'Empieza ahora' }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        }),
      })
    );
  },
  uN = [
    { label: 'Inicio', href: '#inicio' },
    { label: 'Funciones', href: '#funciones' },
    { label: 'Precios', href: '#precios' },
    { label: 'FAQ', href: '#faq' },
    { label: 'Contacto', href: '#contacto' },
  ],
  cN = [
    { icon: ok, href: 'https://facebook.com', label: 'Facebook' },
    { icon: gk, href: 'https://x.com', label: 'Twitter' },
    { icon: uk, href: 'https://linkedin.com', label: 'LinkedIn' },
    { icon: ak, href: 'https://instagram.com', label: 'Instagram' },
  ],
  dN = () =>
    f.jsx('footer', {
      className: 'w-full border-t border-white/[0.06] px-4 md:px-6 lg:px-8',
      children: f.jsxs('div', {
        className: 'max-w-[900px] mx-auto py-6 md:py-7',
        children: [
          f.jsxs('div', {
            className:
              'flex flex-col md:flex-row items-center justify-between gap-4 md:gap-5 mb-5 md:mb-6',
            children: [
              f.jsx('a', {
                className: 'flex-shrink-0',
                href: '/',
                children: f.jsx('img', {
                  src: '/brand/logo-dark.svg',
                  alt: 'Nexova',
                  className: 'h-5 md:h-6 w-auto',
                }),
              }),
              f.jsx('nav', {
                className:
                  'flex flex-wrap items-center justify-center md:justify-end gap-5 md:gap-7',
                children: uN.map((t) =>
                  f.jsx(
                    'a',
                    {
                      href: t.href,
                      className:
                        'text-foreground/40 text-xs hover:text-foreground/70 transition-colors',
                      children: t.label,
                    },
                    t.label
                  )
                ),
              }),
            ],
          }),
          f.jsxs('div', {
            className: 'flex flex-col md:flex-row items-center justify-between gap-3',
            children: [
              f.jsxs('p', {
                className: 'text-foreground/30 text-[11px]',
                children: [
                  '©2026. Disenado por',
                  ' ',
                  f.jsx('a', {
                    href: 'https://designrocket.io/',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'underline hover:text-foreground/50 transition-colors',
                    children: 'Design Rocket',
                  }),
                  ' · Potenciado por ',
                  f.jsx('a', {
                    href: 'https://lovable.dev',
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'underline hover:text-foreground/50 transition-colors',
                    children: 'Lovable',
                  }),
                ],
              }),
              f.jsx('div', {
                className: 'flex items-center gap-2.5',
                children: cN.map((t) =>
                  f.jsx(
                    'a',
                    {
                      href: t.href,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      'aria-label': t.label,
                      className: 'text-foreground/25 hover:text-foreground/50 transition-colors',
                      children: f.jsx(t.icon, {
                        className: 'w-3.5 h-3.5',
                        fill: 'currentColor',
                        strokeWidth: 0,
                      }),
                    },
                    t.label
                  )
                ),
              }),
            ],
          }),
        ],
      }),
    }),
  pN = () =>
    f.jsxs('a', {
      href: 'https://wa.link/wdumko',
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': 'Escribinos por WhatsApp',
      className:
        'fixed bottom-5 right-5 md:bottom-6 md:right-6 z-[70] w-14 h-14 rounded-full bg-[#25D366] text-white shadow-[0_12px_32px_rgba(37,211,102,0.45)] hover:brightness-105 hover:scale-105 transition-all duration-200 flex items-center justify-center',
      children: [
        f.jsx('span', {
          className: 'absolute inset-0 rounded-full animate-ping bg-[#25D366]/30',
          'aria-hidden': !0,
        }),
        f.jsx('svg', {
          viewBox: '0 0 24 24',
          fill: 'currentColor',
          className: 'relative w-7 h-7',
          'aria-hidden': !0,
          children: f.jsx('path', {
            d: 'M12 2C6.486 2 2 6.477 2 11.982c0 1.943.553 3.813 1.603 5.427L2.05 22l4.709-1.53A9.99 9.99 0 0 0 12 21.965c5.514 0 10-4.476 10-9.983C22 6.477 17.514 2 12 2Zm0 18.33a8.33 8.33 0 0 1-4.252-1.164l-.305-.18-2.796.909.913-2.726-.198-.314a8.294 8.294 0 0 1-1.287-4.473c0-4.594 3.754-8.333 8.37-8.333 4.615 0 8.37 3.739 8.37 8.333 0 4.594-3.755 8.33-8.37 8.33Zm4.657-6.229c-.255-.128-1.507-.743-1.741-.826-.233-.085-.403-.128-.573.128-.17.255-.658.826-.806.996-.149.171-.297.192-.553.064-.255-.128-1.079-.396-2.056-1.262-.76-.675-1.273-1.507-1.422-1.762-.148-.255-.016-.393.112-.52.116-.117.255-.304.382-.454.128-.149.17-.255.255-.425.085-.17.042-.319-.021-.447-.063-.128-.573-1.379-.786-1.89-.206-.496-.415-.428-.573-.436l-.488-.008c-.17 0-.446.064-.68.319-.234.255-.892.87-.892 2.124 0 1.252.914 2.463 1.041 2.633.128.17 1.798 2.743 4.355 3.845.608.262 1.084.418 1.454.535.611.194 1.167.166 1.607.101.49-.073 1.507-.616 1.719-1.211.212-.596.212-1.106.149-1.211-.064-.106-.234-.17-.489-.298Z',
          }),
        }),
      ],
    }),
  fN = () =>
    f.jsxs('div', {
      className: "min-h-screen bg-[#040204] font-['Inter',sans-serif]",
      children: [
        f.jsx(LE, {}),
        f.jsx(MP, {}),
        f.jsx(FP, {}),
        f.jsx(qP, {}),
        f.jsx(QP, {}),
        f.jsx(nN, {}),
        f.jsx(oN, {}),
        f.jsx(lN, {}),
        f.jsx(dN, {}),
        f.jsx(pN, {}),
      ],
    });

export default function IndexPage(): JSX.Element {
  return f.jsx(fN, {});
}
