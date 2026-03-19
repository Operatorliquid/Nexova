import {
  AlertCircle,
  BarChart3,
  Bell,
  CalendarDays,
  CreditCard,
  DollarSign,
  LayoutDashboard,
  Megaphone,
  Package,
  ReceiptText,
  Search,
  Settings,
  ShoppingCart,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';

const CARD_BORDER = 'border border-white/[0.06]';

const SIDEBAR_ITEMS = [
  { icon: LayoutDashboard, label: 'Panel', active: true },
  { icon: BarChart3, label: 'Métricas' },
  { icon: Megaphone, label: 'Inbox' },
  { icon: Megaphone, label: 'Comunicación' },
  { icon: ShoppingCart, label: 'Pedidos' },
  { icon: ReceiptText, label: 'Facturación' },
  { icon: Package, label: 'Stock' },
  { icon: Users, label: 'Clientes' },
  { icon: Wallet, label: 'Deudas' },
  { icon: Settings, label: 'Configuración' },
];

const TOP_CARDS = [
  {
    icon: DollarSign,
    label: 'Ventas',
    value: '$845,200',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-t-emerald-500/30',
  },
  {
    icon: ShoppingCart,
    label: 'Pedidos',
    value: '142',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-t-blue-500/30',
  },
  {
    icon: UserPlus,
    label: 'Nuevos',
    value: '8',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-t-orange-500/30',
  },
  {
    icon: CreditCard,
    label: 'Pagado',
    value: '$720,850',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-t-cyan-500/30',
  },
  {
    icon: AlertCircle,
    label: 'Pendiente',
    value: '$124,350',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-t-amber-500/30',
  },
];

const RECENT_ORDERS = [
  { customer: 'María G.', items: 3, total: '$12,400', status: 'Completado', color: 'text-emerald-400', time: 'hace 2m' },
  { customer: 'Carlos R.', items: 1, total: '$4,500', status: 'En proceso', color: 'text-blue-400', time: 'hace 8m' },
  { customer: 'Ana P.', items: 5, total: '$21,000', status: 'Pendiente', color: 'text-amber-400', time: 'hace 15m' },
  { customer: 'Lucas M.', items: 2, total: '$8,900', status: 'Completado', color: 'text-emerald-400', time: 'hace 23m' },
  { customer: 'Sofía T.', items: 4, total: '$15,200', status: 'En proceso', color: 'text-blue-400', time: 'hace 31m' },
];

const TOP_PRODUCTS = [
  { name: 'Plan Empresa', revenue: '$312,000', pct: 100 },
  { name: 'Plan Profesional', revenue: '$245,800', pct: 79 },
  { name: 'Acceso API', revenue: '$128,400', pct: 41 },
  { name: 'Exportacion de datos', revenue: '$89,200', pct: 29 },
  { name: 'Almacenamiento Plus', revenue: '$69,800', pct: 22 },
];

function SalesChart(): JSX.Element {
  const points = [32, 45, 38, 52, 48, 61, 55, 72, 65, 80, 74, 88, 82, 95, 90, 78, 85, 92, 98, 105, 96, 110, 102, 115];
  const max = Math.max(...points);
  const width = 400;
  const height = 100;
  const line = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index / (points.length - 1)) * width} ${height - (value / max) * (height - 8)}`)
    .join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="heroChartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#heroChartFill)" />
      <path d={line} fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OrdersDonut(): JSX.Element {
  const segments = [
    { pct: 0.45, color: '#22c55e' },
    { pct: 0.25, color: '#3b82f6' },
    { pct: 0.18, color: '#fbbf24' },
    { pct: 0.12, color: '#ef4444' },
  ];
  const cx = 40;
  const cy = 40;
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox="0 0 80 80" className="h-full w-full">
      {segments.map((segment, index) => {
        const dash = `${segment.pct * circumference} ${circumference}`;
        const angle = offset * 360 - 90;
        offset += segment.pct;
        return (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth="12"
            strokeDasharray={dash}
            transform={`rotate(${angle} ${cx} ${cy})`}
          />
        );
      })}
      <circle cx={cx} cy={cy} r="24" fill="#060302" />
    </svg>
  );
}

export default function HeroDashboardMockup(): JSX.Element {
  return (
    <div className="mb-0 -mt-20 w-full" style={{ opacity: 1 }}>
      <div className="mx-auto max-w-[1050px] translate-x-[15%] [perspective:1200px] md:translate-x-[10%] lg:translate-x-[5%]">
        <div className="origin-top scale-[0.85] [transform:rotateX(20deg)] lg:scale-[0.92]">
          <div className="relative skew-x-[.36rad]">
            <div className="relative mx-auto mt-6 w-full max-w-[1100px] md:mt-10">
              <div
                className="relative overflow-hidden rounded-t-2xl border border-white/10 bg-[#060302]"
                style={{
                  boxShadow: '0 0 120px inset rgba(255,255,255,0.04), 0 0 60px inset rgba(255,255,255,0.03)',
                }}
              >
                <div className="flex h-[380px] sm:h-[430px] md:h-[520px]">
                  <div className="hidden border-r border-white/[0.06] md:block">
                    <div className="flex h-full w-44 flex-col">
                      <div className="p-3 pb-2">
                        <img src="/brand/logo-dark.svg" alt="Nexova" className="h-4 w-auto" />
                      </div>
                      <div className="px-3 pb-2">
                        <div
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${CARD_BORDER}`}
                          style={{ boxShadow: '0 0 20px inset rgba(255,255,255,0.04)' }}
                        >
                          <Search className="h-3 w-3 text-white/40" />
                          <span className="text-[10px] text-white/40">Buscar...</span>
                        </div>
                      </div>
                      <div className="flex-1 px-3">
                        <div className="flex flex-col gap-0.5">
                          {SIDEBAR_ITEMS.map((item) => (
                            <div
                              key={item.label}
                              className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                                item.active ? `text-white ${CARD_BORDER}` : 'text-white/50'
                              }`}
                              style={item.active ? { boxShadow: '0 0 20px inset rgba(255,255,255,0.04)' } : {}}
                            >
                              <item.icon className="h-3 w-3" />
                              <span className="text-[10px]">{item.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="border-t border-white/[0.06] p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500/20">
                            <span className="text-[8px] font-bold text-orange-300">JD</span>
                          </div>
                          <div className="min-w-0">
                            <span className="block truncate text-[9px] font-medium text-white">John Doe</span>
                            <span className="block truncate text-[8px] text-white/30">john@nexova.io</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 md:px-4 md:py-2.5">
                      <h2 className="text-[11px] font-semibold text-white md:text-xs">Panel general</h2>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.04] px-2 py-1">
                          <CalendarDays className="h-2.5 w-2.5 text-white/40" />
                          <span className="text-[9px] text-white/50">Este mes</span>
                        </div>
                        <div className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.04]">
                          <Bell className="h-3 w-3 text-white/50" />
                        </div>
                      </div>
                    </div>

                    <div className="px-3 py-2 md:px-4 md:py-3">
                      <h2 className="text-xs font-semibold text-white md:text-sm">Hola, Juan</h2>
                      <p className="text-[9px] text-white/40 md:text-[10px]">Resumen general de tu negocio</p>
                    </div>

                    <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 md:mx-4">
                      <AlertCircle className="h-3 w-3 flex-shrink-0 text-orange-400" />
                      <span className="text-[9px] text-orange-300">8 pedidos nuevos esperando aprobación</span>
                      <span className="ml-auto whitespace-nowrap text-[8px] font-medium text-orange-400">Revisar →</span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 px-3 pb-2 md:grid-cols-5 md:gap-2 md:px-4">
                      {TOP_CARDS.map((card) => (
                        <div
                          key={card.label}
                          className={`rounded-lg border-t-2 p-2 md:p-2.5 ${card.border} ${CARD_BORDER}`}
                          style={{ background: 'rgba(255,255,255,0.02)' }}
                        >
                          <div className="mb-1.5 flex items-center gap-1.5">
                            <div className={`flex h-5 w-5 items-center justify-center rounded-md md:h-6 md:w-6 ${card.bg}`}>
                              <card.icon className={`h-2.5 w-2.5 md:h-3 md:w-3 ${card.color}`} />
                            </div>
                            <span className="text-[8px] text-white/40 md:text-[9px]">{card.label}</span>
                          </div>
                          <span className="text-[11px] font-semibold text-white md:text-sm">{card.value}</span>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-2 px-3 pb-2 md:grid-cols-3 md:px-4">
                      <div className={`overflow-hidden rounded-lg ${CARD_BORDER} md:col-span-2`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <div className="flex items-center justify-between border-b border-white/[0.04] px-2.5 py-2">
                          <div>
                            <span className="text-[10px] font-medium text-white">Ventas del mes</span>
                            <p className="text-[8px] text-white/30">Ingresos y pedidos</p>
                          </div>
                          <div className="flex gap-1">
                            {['Hoy', 'Semana', 'Mes'].map((period, index) => (
                              <span
                                key={period}
                                className={`rounded px-1.5 py-0.5 text-[7px] ${index === 2 ? 'bg-white/10 text-white' : 'text-white/30'}`}
                              >
                                {period}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="h-20 p-2 md:h-28">
                          <SalesChart />
                        </div>
                      </div>

                      <div className={`hidden overflow-hidden rounded-lg ${CARD_BORDER} md:block`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <div className="border-b border-white/[0.04] px-2.5 py-2">
                          <span className="text-[10px] font-medium text-white">Estado pedidos</span>
                        </div>
                        <div className="flex items-center gap-2 p-2">
                          <div className="h-16 w-16 flex-shrink-0">
                            <OrdersDonut />
                          </div>
                          <div className="flex flex-col gap-1">
                            {[
                              { label: 'Completado', color: 'bg-emerald-500', pct: '45%' },
                              { label: 'En proceso', color: 'bg-blue-500', pct: '25%' },
                              { label: 'Pendiente', color: 'bg-amber-500', pct: '18%' },
                              { label: 'Cancelado', color: 'bg-red-500', pct: '12%' },
                            ].map((item) => (
                              <div key={item.label} className="flex items-center gap-1">
                                <div className={`h-1 w-1 rounded-full ${item.color}`} />
                                <span className="text-[7px] text-white/40">{item.label}</span>
                                <span className="ml-auto text-[7px] text-white/60">{item.pct}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="hidden min-h-0 flex-1 grid-cols-1 gap-2 px-3 pb-3 sm:grid md:grid-cols-5 md:px-4">
                      <div className={`overflow-hidden rounded-lg ${CARD_BORDER} flex flex-col md:col-span-3`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <div className="flex items-center justify-between border-b border-white/[0.04] px-2.5 py-2">
                          <span className="text-[10px] font-medium text-white">Pedidos recientes</span>
                          <span className="text-[8px] text-orange-400/80">Ver todos</span>
                        </div>
                        <div className="grid grid-cols-5 gap-1 border-b border-white/[0.03] px-2.5 py-1 text-[7px] uppercase tracking-wider text-white/30">
                          <span>Cliente</span>
                          <span>Productos</span>
                          <span>Total</span>
                          <span>Estado</span>
                          <span>Tiempo</span>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          {RECENT_ORDERS.map((order) => (
                            <div key={order.customer} className="grid grid-cols-5 gap-1 border-b border-white/[0.02] px-2.5 py-1.5 text-[9px]">
                              <span className="truncate text-white/70">{order.customer}</span>
                              <span className="text-white/40">{order.items}</span>
                              <span className="text-white/80">{order.total}</span>
                              <span className={order.color}>{order.status}</span>
                              <span className="text-white/30">{order.time}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className={`overflow-hidden rounded-lg ${CARD_BORDER} flex flex-col md:col-span-2`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <div className="border-b border-white/[0.04] px-2.5 py-2">
                          <span className="text-[10px] font-medium text-white">Top productos</span>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          {TOP_PRODUCTS.map((product, index) => (
                            <div key={product.name} className="border-b border-white/[0.02] px-2.5 py-1.5">
                              <div className="mb-0.5 flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[8px] text-white/25">{index + 1}</span>
                                  <span className="truncate text-[9px] text-white/80">{product.name}</span>
                                </div>
                                <span className="text-[8px] text-white/60">{product.revenue}</span>
                              </div>
                              <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                                <div className="h-full rounded-full bg-orange-500/40" style={{ width: `${product.pct}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 md:h-32"
                  style={{ background: 'linear-gradient(to top, #060302 0%, transparent 100%)' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
