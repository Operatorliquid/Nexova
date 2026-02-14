import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import {
  motion,
  useScroll,
  useSpring,
  useInView as useMotionInView,
  AnimatePresence,
} from 'motion/react';
import {
  MessageSquare,
  ShoppingCart,
  BarChart3,
  Package,
  Users,
  CreditCard,
  Bot,
  Zap,
  Shield,
  Clock,
  TrendingUp,
  FileText,
  Bell,
  ChevronDown,
  ArrowRight,
  Check,
  Star,
  Sparkles,
  Send,
  Globe,
  Layers,
  Receipt,
  Store,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

/* ───────────────────────── helpers ───────────────────────── */

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useMotionInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: delay / 1000 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function useCountUp(target: number, duration = 2000, active = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, active]);
  return value;
}

/* ───────────────────────── data ───────────────────────── */

const salesData = [
  { name: 'Lun', ventas: 245000 },
  { name: 'Mar', ventas: 312000 },
  { name: 'Mié', ventas: 287000 },
  { name: 'Jue', ventas: 398000 },
  { name: 'Vie', ventas: 456000 },
  { name: 'Sáb', ventas: 523000 },
  { name: 'Dom', ventas: 189000 },
];

const monthlyGrowth = [
  { name: 'Ene', actual: 1850000, anterior: 1420000 },
  { name: 'Feb', actual: 2100000, anterior: 1580000 },
  { name: 'Mar', actual: 2340000, anterior: 1750000 },
  { name: 'Abr', actual: 2680000, anterior: 1890000 },
  { name: 'May', actual: 3150000, anterior: 2050000 },
  { name: 'Jun', actual: 3520000, anterior: 2280000 },
];

const paymentMethodData = [
  { name: 'Efectivo', value: 45, color: '#34d399' },
  { name: 'Transferencia', value: 30, color: '#22d3ee' },
  { name: 'Link de pago', value: 20, color: '#4D7CFF' },
  { name: 'Otros', value: 5, color: '#6b7280' },
];

const features = [
  { icon: Bot, title: 'Agente IA 24/7', description: 'Un asistente inteligente que atiende a tus clientes por WhatsApp, toma pedidos y procesa pagos sin descanso.', color: 'from-emerald-500 to-teal-600', bg: 'bg-emerald-500/15', iconColor: 'text-emerald-400' },
  { icon: ShoppingCart, title: 'Gestión de pedidos', description: 'Desde la conversación hasta la entrega. Control total del ciclo de venta con seguimiento en tiempo real.', color: 'from-blue-500 to-indigo-600', bg: 'bg-blue-500/15', iconColor: 'text-blue-400' },
  { icon: Package, title: 'Control de stock', description: 'Inventario en tiempo real con alertas de stock bajo, múltiples unidades y categorías inteligentes.', color: 'from-amber-500 to-orange-600', bg: 'bg-amber-500/15', iconColor: 'text-amber-400' },
  { icon: Users, title: 'CRM integrado', description: 'Base de clientes con historial de compras, scoring de pago, notas y seguimiento de deudas.', color: 'from-purple-500 to-violet-600', bg: 'bg-purple-500/15', iconColor: 'text-purple-400' },
  { icon: BarChart3, title: 'Analytics con IA', description: 'Métricas de ventas, insights generados por IA, tendencias y recomendaciones accionables.', color: 'from-cyan-500 to-blue-600', bg: 'bg-cyan-500/15', iconColor: 'text-cyan-400' },
  { icon: CreditCard, title: 'Pagos y facturación', description: 'Integración con MercadoPago, procesamiento de comprobantes con visión IA y facturación ARCA/AFIP.', color: 'from-rose-500 to-pink-600', bg: 'bg-rose-500/15', iconColor: 'text-rose-400' },
];

const solutions = [
  { icon: Store, title: 'Comercios minoristas', description: 'Almacenes, kioscos, distribuidoras y comercios de barrio que quieren automatizar la atención y profesionalizar sus ventas.', items: ['Catálogo digital por WhatsApp', 'Pedidos automáticos', 'Control de fiado y deudas'] },
  { icon: Globe, title: 'E-commerce', description: 'Tiendas online que necesitan un canal conversacional potente para aumentar conversiones y fidelizar clientes.', items: ['Atención 24/7 sin RRHH extra', 'Integración con medios de pago', 'Seguimiento automatizado'] },
  { icon: Layers, title: 'Equipos de venta', description: 'Empresas con múltiples vendedores que necesitan centralizar operaciones y tener visibilidad total.', items: ['Roles y permisos granulares', 'Dashboard de métricas por equipo', 'Inbox colaborativo'] },
];

const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:5173';

const plans = [
  { code: 'basic', name: 'Basic', price: '47,72', period: '/mes', description: 'Para negocios que arrancan con WhatsApp commerce.', features: ['Agente IA básico', 'Hasta 500 conversaciones/mes', 'Gestión de pedidos', 'Control de stock', 'CRM de clientes', '1 número WhatsApp', 'Soporte por email'], cta: 'Elegir Basic', highlighted: false },
  { code: 'standard', name: 'Standard', price: '112,05', period: '/mes', description: 'Para negocios en crecimiento que necesitan más.', features: ['Todo de Starter +', 'Conversaciones ilimitadas', 'Analytics con IA', 'Facturación ARCA/AFIP', 'Control de deudas', 'MercadoPago integrado', 'Roles y permisos', '3 números WhatsApp', 'Soporte prioritario'], cta: 'Elegir Standard', highlighted: true },
  { code: 'pro', name: 'Pro', price: '174,03', period: '/mes', description: 'Para operaciones avanzadas con todo habilitado.', features: ['Todo de Standard +', 'Quick actions completas', 'Owner asistido por WhatsApp', 'Automatizaciones avanzadas', 'Soporte prioritario', 'Escalabilidad total'], cta: 'Elegir Pro', highlighted: false },
];

const faqs = [
  { q: '¿Cómo funciona el agente de IA?', a: 'Nuestro agente usa inteligencia artificial avanzada (Claude) para entender mensajes de WhatsApp, buscar productos, armar pedidos, procesar pagos y responder consultas. Todo en español argentino y de forma natural. Si algo se complica, escala automáticamente a un humano.' },
  { q: '¿Necesito conocimientos técnicos?', a: 'No. Nexova está diseñado para que cualquier comerciante pueda configurarlo en minutos. Solo necesitás cargar tus productos, conectar tu número de WhatsApp y el agente empieza a trabajar.' },
  { q: '¿Puedo conectar mi número de WhatsApp actual?', a: 'Sí. Usamos la API oficial de WhatsApp Business a través de Infobip, lo que garantiza que tu número siga funcionando normalmente mientras el agente atiende las conversaciones.' },
  { q: '¿Qué pasa con los comprobantes de pago?', a: 'Cuando un cliente envía una foto o PDF de un comprobante, nuestra IA con visión artificial extrae automáticamente el monto, la fecha y los datos relevantes. Vos solo confirmás y se registra el pago.' },
  { q: '¿Funciona con facturación electrónica?', a: 'Sí. Tenemos integración directa con ARCA (ex-AFIP) para generar facturas electrónicas automáticamente desde los pedidos, con CAE, punto de venta y todo lo necesario.' },
  { q: '¿Puedo probarlo gratis?', a: 'Absolutamente. Ofrecemos 14 días gratis en cualquier plan sin necesidad de tarjeta de crédito. Configurá tu negocio, probá el agente y decidí si es para vos.' },
];

const testimonials = [
  { name: 'María González', role: 'Dueña de distribuidora', text: 'Desde que activamos el agente, las ventas por WhatsApp subieron un 40%. Mis clientes hacen pedidos a cualquier hora y yo solo verifico por la mañana.', stars: 5 },
  { name: 'Carlos Méndez', role: 'E-commerce de indumentaria', text: 'Lo que más me gustó es el dashboard de métricas. Ahora tomo decisiones con datos, no con intuición. Y la integración con MercadoPago es perfecta.', stars: 5 },
  { name: 'Laura Sánchez', role: 'Kiosco y almacén', text: 'El control de fiado es un antes y un después. Mis clientes pagan a tiempo porque les llega el recordatorio automático por WhatsApp.', stars: 5 },
  { name: 'Rodrigo Peralta', role: 'Mayorista de alimentos', text: 'Procesamos más de 200 pedidos semanales sin contratar personal extra. El agente IA maneja todo y el stock se actualiza solo.', stars: 5 },
  { name: 'Florencia Ruiz', role: 'Tienda de cosmética', text: 'La facturación automática con ARCA nos ahorra horas por semana. Y los insights de IA nos ayudan a planificar las compras.', stars: 5 },
  { name: 'Diego Martínez', role: 'Ferretería industrial', text: 'Mis clientes ahora consultan precios y hacen pedidos por WhatsApp las 24hs. Las ventas nocturnas representan un 25% del total.', stars: 5 },
];

/* ── SVG logo (shared) ── */
const NexovaLogo = ({ className = 'h-6 w-auto', fill = 'white' }: { className?: string; fill?: string }) => (
  <svg className={className} viewBox="0 0 878 171" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M258.65 92.31L183.53 167.43H183.51C181.12 169.14 178.18 170.14 175.02 170.14C167.16 170.14 160.75 163.97 160.38 156.2V95.84H160.35C160.36 95.72 160.36 95.6 160.36 95.48C160.36 87.82 154.15 81.61 146.48 81.61C142.64 81.61 139.16 83.17 136.65 85.69L58.6 164.12L55.44 167.3L55.41 167.33C52.99 169.1 50.01 170.14 46.78 170.14C39.47 170.14 33.41 164.8 32.3 157.8V95.24L32.21 95.21C32.19 87.42 25.87 81.11 18.07 81.11C13.82 81.11 10 82.99 7.42 85.96L0 78.24L1.45 76.78L73.43 4.8L73.69 4.53C76.36 1.74 80.12 0 84.29 0C92.39 0 98.95 6.56 98.95 14.66V74.03C98.95 75.14 99.08 76.22 99.33 77.25C100.78 83.36 106.28 87.91 112.83 87.91C116.34 87.91 119.16 86.96 121.6 84.82H121.61L121.71 84.72C122.08 84.39 122.44 84.03 122.78 83.65L202.47 3.95L202.49 3.93C205.11 1.47 208.66 0 212.54 0C220.64 0 227.2 6.56 227.2 14.66V71.07C227.2 72.04 227.24 73 227.32 73.97C227.35 74.22 227.37 74.48 227.38 74.81C227.73 81.91 233.15 87.88 240.24 88.37C244.51 88.66 247.97 87.09 250.7 84.37L258.65 92.31Z" fill={fill}/>
    <path d="M834.333 134.627C847.75 134.627 858.236 125.386 858.236 113.212V105.837L835.221 107.259C823.758 108.059 817.272 113.124 817.272 121.121C817.272 129.296 824.025 134.627 834.333 134.627ZM829.001 149.822C810.696 149.822 797.901 138.448 797.901 121.654C797.901 105.304 810.43 95.263 832.644 94.019L858.236 92.5084V85.3108C858.236 74.9144 851.216 68.6943 839.486 68.6943C828.379 68.6943 821.448 74.0258 819.76 82.3785H801.633C802.699 65.4954 817.094 53.0552 840.197 53.0552C862.856 53.0552 877.34 65.0511 877.34 83.8002V148.223H858.946V132.85H858.502C853.082 143.247 841.264 149.822 829.001 149.822Z" fill={fill}/>
    <path d="M792.569 54.7437L759.069 148.223H738.454L704.777 54.7437H725.214L748.673 129.474H749.028L772.487 54.7437H792.569Z" fill={fill}/>
    <path d="M656.082 150C629.336 150 611.742 131.606 611.742 101.483C611.742 71.4489 629.425 53.0552 656.082 53.0552C682.74 53.0552 700.423 71.4489 700.423 101.483C700.423 131.606 682.829 150 656.082 150ZM656.082 134.183C671.188 134.183 680.874 122.276 680.874 101.483C680.874 80.779 671.099 68.872 656.082 68.872C641.065 68.872 631.291 80.779 631.291 101.483C631.291 122.276 641.065 134.183 656.082 134.183Z" fill={fill}/>
    <path d="M563.847 113.835H563.403L542.699 148.223H521.906L552.74 101.572L522.35 54.7437H543.854L564.292 88.5987H564.647L584.818 54.7437H605.966L575.31 100.95L605.611 148.223H584.462L563.847 113.835Z" fill={fill}/>
    <path d="M473.389 68.5166C459.972 68.5166 450.553 78.7353 449.575 92.8638H496.315C495.871 78.5576 486.807 68.5166 473.389 68.5166ZM496.226 120.765H514.442C511.776 137.826 495.604 150 474.189 150C446.732 150 430.115 131.428 430.115 101.927C430.115 72.604 446.998 53.0552 473.389 53.0552C499.336 53.0552 515.508 71.36 515.508 99.7059V106.281H449.486V107.437C449.486 123.698 459.261 134.45 474.633 134.45C485.563 134.45 493.649 128.94 496.226 120.765Z" fill={fill}/>
    <path d="M327.661 148.223H308.29V20H326.328L392.794 114.545H393.505V20H412.877V148.223H394.927L328.461 53.7662H327.661V148.223Z" fill={fill}/>
  </svg>
);

/* ───────────────────────── components ───────────────────────── */

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { label: 'Funciones', href: '#features' },
    { label: 'Soluciones', href: '#solutions' },
    { label: 'Precios', href: '#pricing' },
    { label: 'FAQ', href: '#faq' },
  ];

  return (
    <>
      <motion.div className="fixed top-0 left-0 right-0 h-[2px] z-[60] origin-left bg-gradient-to-r from-[#00FFD1] via-[#4D7CFF] via-60% via-[#8B5CF6] to-[#EC4899]" style={{ scaleX }} />
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/[0.06] shadow-2xl' : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="#hero" className="flex items-center gap-2 group">
            <NexovaLogo />
          </a>
          <div className="hidden md:flex items-center gap-8">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="text-sm text-white/60 hover:text-white transition-colors duration-200">{l.label}</a>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <a href={`${DASHBOARD_URL}/login`} className="text-sm text-white/70 hover:text-white transition-colors px-4 py-2">Iniciar sesión</a>
            <a href="/cart?plan=standard" className="text-sm font-medium text-white bg-gradient-to-r from-[#4D7CFF] to-[#8B5CF6] px-5 py-2.5 rounded-xl transition-all duration-200 shadow-lg shadow-[#8B5CF6]/25 hover:shadow-[#8B5CF6]/40 hover:brightness-110">Empezar gratis</a>
          </div>
          <button className="md:hidden p-2 text-white/70" onClick={() => setMobileOpen(!mobileOpen)}>
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileOpen ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
        <AnimatePresence>
          {mobileOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="md:hidden bg-[#0a0a0f]/95 backdrop-blur-xl border-t border-white/[0.06] px-6 py-4 space-y-3 overflow-hidden">
              {links.map((l) => (<a key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="block text-sm text-white/60 hover:text-white py-2">{l.label}</a>))}
              <div className="flex gap-3 pt-3 border-t border-white/[0.06]">
                <a href={`${DASHBOARD_URL}/login`} className="text-sm text-white/70 py-2">Iniciar sesión</a>
                <a href="/cart?plan=standard" className="text-sm font-medium text-white bg-gradient-to-r from-[#4D7CFF] to-[#8B5CF6] px-5 py-2.5 rounded-xl">Empezar gratis</a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </>
  );
}

function HeroSection() {
  const heroRef = useRef<HTMLDivElement>(null);
  const heroVisible = useMotionInView(heroRef, { once: true, margin: '-10%' });

  const salesCount = useCountUp(523400, 2200, !!heroVisible);
  const ordersCount = useCountUp(42, 1800, !!heroVisible);
  const responseRate = useCountUp(98, 2000, !!heroVisible);

  const [notifs, setNotifs] = useState<number[]>([]);
  useEffect(() => {
    if (!heroVisible) return;
    const timers = [
      setTimeout(() => setNotifs((p) => [...p, 1]), 1200),
      setTimeout(() => setNotifs((p) => [...p, 2]), 2800),
      setTimeout(() => setNotifs((p) => [...p, 3]), 4200),
    ];
    return () => timers.forEach(clearTimeout);
  }, [heroVisible]);

  const wordVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number], delay: 0.2 + i * 0.09 } }),
  };

  return (
    <section id="hero" ref={heroRef} className="relative min-h-screen flex items-center overflow-hidden pt-20 pb-16 lg:pt-24">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute w-[700px] h-[700px] bg-[#4D7CFF]/[0.20] rounded-full blur-[140px] top-[-10%] left-[-10%]" style={{ animation: 'float 12s ease-in-out infinite' }} />
        <div className="absolute w-[500px] h-[500px] bg-purple-600/[0.18] rounded-full blur-[120px] bottom-[-5%] right-[-5%]" style={{ animation: 'float 10s ease-in-out infinite reverse' }} />
        <div className="absolute w-[400px] h-[400px] bg-emerald-500/[0.12] rounded-full blur-[100px] top-[40%] right-[20%]" style={{ animation: 'float 14s ease-in-out infinite', animationDelay: '3s' }} />
        <div className="absolute w-[500px] h-[500px] bg-[#00FFD1]/[0.12] rounded-full blur-[130px] top-[-5%] right-[5%]" style={{ animation: 'float 11s ease-in-out infinite', animationDelay: '1s' }} />
        <div className="absolute w-[400px] h-[400px] bg-[#EC4899]/[0.08] rounded-full blur-[110px] bottom-[10%] left-[5%]" style={{ animation: 'float 13s ease-in-out infinite', animationDelay: '5s' }} />
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        <div className="absolute inset-0 opacity-20" style={{ background: 'conic-gradient(from 0deg at 50% 50%, #00FFD1, #4D7CFF, #8B5CF6, #EC4899, #00FFD1)', filter: 'blur(120px)', animation: 'aurora 20s linear infinite' }} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#08080d_75%)]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-[1fr,1.1fr] gap-12 lg:gap-8 items-center">
          <div className="max-w-xl">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={heroVisible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6 }} className="gradient-border inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] backdrop-blur-sm mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00FFD1] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00FFD1]" />
              </span>
              <span className="text-sm bg-gradient-to-r from-[#00FFD1] to-[#4D7CFF] bg-clip-text text-transparent font-medium">Potenciado por IA</span>
            </motion.div>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] xl:text-6xl font-bold tracking-tight leading-[1.08] mb-6">
              {['Vendé', 'más.', 'Atendé', 'mejor.', 'Crecé', 'sin', 'límites.'].map((word, i) => (
                <motion.span key={i} custom={i} initial="hidden" animate={heroVisible ? 'visible' : 'hidden'} variants={wordVariants} className={`inline-block mr-[0.3em] ${[0, 2, 4].includes(i) ? 'bg-gradient-to-r from-[#00FFD1] via-[#4D7CFF] to-[#EC4899] bg-clip-text text-transparent' : 'text-white'}`}>
                  {word}
                </motion.span>
              ))}
            </h1>

            <motion.p initial={{ opacity: 0, y: 20 }} animate={heroVisible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, delay: 0.8 }} className="text-base sm:text-lg text-white/45 leading-relaxed mb-8 max-w-md">
              Nexova conecta un agente de IA a tu WhatsApp para atender clientes, tomar pedidos y cobrar por vos. Vos solo mirás el dashboard.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={heroVisible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, delay: 0.95 }} className="flex flex-col sm:flex-row gap-3 mb-10">
              <a href="/cart?plan=standard" className="group relative flex items-center justify-center gap-2 text-white font-medium px-7 py-3.5 rounded-2xl text-sm transition-all duration-300 shadow-[0_0_40px_rgba(0,255,209,0.3)] hover:shadow-[0_0_60px_rgba(0,255,209,0.4)] hover:-translate-y-0.5 overflow-hidden" style={{ background: 'linear-gradient(90deg, #00FFD1, #4D7CFF, #8B5CF6)', backgroundSize: '200% 100%', animation: 'gradient-shift 4s ease-in-out infinite' }}>
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                <span className="relative">Empezar gratis</span>
                <ArrowRight className="relative w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
              <a href="#features" className="gradient-border flex items-center justify-center gap-2 text-white/60 hover:text-white font-medium px-7 py-3.5 rounded-2xl text-sm hover:bg-white/[0.04] transition-all duration-300">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                Ver demo
              </a>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={heroVisible ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, delay: 1.1 }} className="flex items-center gap-4">
              <div className="flex -space-x-2.5">
                {['bg-gradient-to-br from-blue-400 to-indigo-500', 'bg-gradient-to-br from-emerald-400 to-teal-500', 'bg-gradient-to-br from-purple-400 to-pink-500', 'bg-gradient-to-br from-amber-400 to-orange-500'].map((bg, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full border-2 border-[#08080d] ${bg} flex items-center justify-center`}>
                    <span className="text-[10px] font-bold text-white">{['MG', 'CS', 'LS', 'JP'][i]}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center gap-1">{[...Array(5)].map((_, i) => <Star key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />)}</div>
                <p className="text-xs text-white/30 mt-0.5">Comercios que ya confían en Nexova</p>
              </div>
            </motion.div>
          </div>

          {/* Bento Grid - Responsive */}
          <motion.div initial={{ opacity: 0, x: 40, scale: 0.95 }} animate={heroVisible ? { opacity: 1, x: 0, scale: 1 } : {}} transition={{ duration: 0.8, delay: 0.3 }} className="relative">
            <div className="absolute -inset-8 bg-gradient-to-br from-[#4D7CFF]/10 via-transparent to-purple-600/10 rounded-[2rem] blur-2xl pointer-events-none" />
            <div className="relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 lg:grid-rows-5 gap-3 lg:min-h-[480px]">
              {/* Revenue card */}
              <div className="lg:col-span-3 lg:row-span-2 rounded-2xl border border-white/[0.10] bg-white/[0.05] backdrop-blur-md p-5 flex flex-col justify-between overflow-hidden group hover:border-white/[0.20] transition-all duration-500 relative">
                <div>
                  <div className="flex items-center gap-2 mb-1"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /><span className="text-[11px] text-white/30 font-medium uppercase tracking-wider">En vivo</span></div>
                  <p className="text-xs text-white/40 mb-2">Ventas del día</p>
                </div>
                <div>
                  <span className="text-3xl font-bold text-white tabular-nums">${salesCount.toLocaleString('es-AR')}</span>
                  <div className="flex items-center gap-1.5 mt-1.5"><TrendingUp className="w-3.5 h-3.5 text-emerald-400" /><span className="text-xs text-emerald-400 font-semibold">+18.3%</span><span className="text-[11px] text-white/20">vs ayer</span></div>
                </div>
                <svg className="absolute bottom-0 right-0 w-32 h-16 opacity-20" viewBox="0 0 120 50" fill="none"><path d="M0 45 Q20 40 30 30 T60 20 T90 10 T120 5" stroke="#4D7CFF" strokeWidth="2" fill="none" /><path d="M0 45 Q20 40 30 30 T60 20 T90 10 T120 5 V50 H0Z" fill="url(#sparkFill)" /><defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4D7CFF" stopOpacity="0.3" /><stop offset="100%" stopColor="#4D7CFF" stopOpacity="0" /></linearGradient></defs></svg>
              </div>

              {/* Orders */}
              <div className="lg:col-span-3 lg:row-span-1 rounded-2xl border border-white/[0.10] bg-white/[0.05] backdrop-blur-md p-4 flex items-center gap-4 overflow-hidden hover:border-white/[0.20] transition-all duration-500">
                <div className="w-11 h-11 rounded-xl bg-[#4D7CFF]/10 flex items-center justify-center flex-shrink-0"><ShoppingCart className="w-5 h-5 text-[#4D7CFF]" /></div>
                <div className="flex-1 min-w-0"><p className="text-xs text-white/35">Pedidos hoy</p><span className="text-2xl font-bold text-white tabular-nums">{ordersCount}</span></div>
                <div className="flex gap-0.5 h-8 items-end">{[40, 65, 50, 80, 60, 90, 75].map((h, i) => <div key={i} className="w-1.5 rounded-full bg-[#4D7CFF]/40 transition-all duration-1000" style={{ height: heroVisible ? `${h}%` : '10%', transitionDelay: `${800 + i * 100}ms` }} />)}</div>
              </div>

              {/* AI Agent */}
              <div className="lg:col-span-3 lg:row-span-1 rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.05] backdrop-blur-md p-4 flex items-center gap-3 overflow-hidden hover:border-emerald-500/25 transition-all duration-500">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0 relative"><Bot className="w-5 h-5 text-emerald-400" /><div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0d0d14]" /></div>
                <div className="flex-1 min-w-0"><p className="text-xs text-emerald-400/60">Agente IA</p><div className="flex items-center gap-2"><span className="text-sm font-semibold text-emerald-400">Activo</span><span className="text-[11px] text-white/20">·</span><span className="text-xs text-white/30">{responseRate}% respuestas</span></div></div>
                <div className="flex gap-1 items-center">{[0, 1, 2].map((i) => <div key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: `${i * 200}ms` }} />)}</div>
              </div>

              {/* Chat preview */}
              <div className="lg:col-span-4 lg:row-span-3 rounded-2xl border border-white/[0.10] bg-white/[0.05] backdrop-blur-md overflow-hidden flex flex-col hover:border-white/[0.20] transition-all duration-500">
                <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.05] bg-white/[0.02]">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center"><MessageSquare className="w-3.5 h-3.5 text-emerald-400" /></div>
                  <div className="flex-1 min-w-0"><p className="text-xs font-medium text-white/70 truncate">WhatsApp Business</p><p className="text-[10px] text-emerald-400/60">3 conversaciones activas</p></div>
                </div>
                <div className="flex-1 px-4 py-3 space-y-2.5 overflow-hidden">
                  <div className="flex justify-end"><div className="max-w-[80%] rounded-xl rounded-tr-sm bg-[#4D7CFF]/10 border border-[#4D7CFF]/[0.06] px-3 py-2"><p className="text-xs text-white/80">Hola, quiero 3 Coca 2L y 2 packs de agua</p><span className="text-[9px] text-white/20 block text-right mt-0.5">14:23</span></div></div>
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0 mt-0.5"><Bot className="w-3 h-3 text-emerald-400" /></div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.02] border border-white/[0.04] w-fit"><div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" /><span className="text-[10px] text-white/25 font-mono">search_products → 2 items</span></div>
                      <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-white/[0.03] border border-white/[0.05] px-3 py-2"><p className="text-xs text-white/80 leading-relaxed">¡Listo! Tu pedido:<br />3x Coca Cola 2L — <span className="text-emerald-400">$9.000</span><br />2x Agua Pack x6 — <span className="text-emerald-400">$9.600</span><br /><span className="font-semibold text-white/90 mt-1 inline-block">Total: $18.600</span></p></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Mini chart - desktop only */}
              <div className="hidden lg:flex lg:col-span-2 lg:row-span-2 rounded-2xl border border-white/[0.10] bg-white/[0.05] backdrop-blur-md p-4 flex-col justify-between overflow-hidden hover:border-white/[0.20] transition-all duration-500">
                <div><p className="text-[10px] text-white/30 uppercase tracking-wider font-medium">Semana</p><p className="text-xs text-white/50 mt-0.5">Ingresos</p></div>
                <div className="flex-1 mt-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={salesData} barSize={6}><Bar dataKey="ventas" fill="#A78BFA" radius={[3, 3, 0, 0]} opacity={0.6} /></BarChart></ResponsiveContainer></div>
              </div>

              {/* Quick stat - desktop only */}
              <div className="hidden lg:flex lg:col-span-2 lg:row-span-1 rounded-2xl border border-white/[0.10] bg-white/[0.05] backdrop-blur-md p-4 items-center gap-3 overflow-hidden hover:border-white/[0.20] transition-all duration-500">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0"><Users className="w-4 h-4 text-amber-400" /></div>
                <div><p className="text-[10px] text-white/30">Clientes</p><span className="text-lg font-bold text-white">+8</span><span className="text-[10px] text-emerald-400/70 ml-1">hoy</span></div>
              </div>
            </div>

            {/* Floating notifications - desktop only */}
            <div className="absolute -left-4 top-0 bottom-0 w-64 pointer-events-none hidden lg:block">
              {notifs.includes(1) && (<div className="absolute top-12 -left-2" style={{ animation: 'slide-in-notification 0.5s ease-out forwards' }}><div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#0d0d14]/90 border border-emerald-500/15 backdrop-blur-xl shadow-2xl"><div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0"><ShoppingCart className="w-3.5 h-3.5 text-emerald-400" /></div><div><p className="text-[10px] text-emerald-400/70 font-medium">Nuevo pedido</p><p className="text-xs text-white/70 font-medium">ORD-00042 · $18.600</p></div></div></div>)}
              {notifs.includes(2) && (<div className="absolute top-32 -left-6" style={{ animation: 'slide-in-notification 0.5s ease-out forwards' }}><div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#0d0d14]/90 border border-[#4D7CFF]/15 backdrop-blur-xl shadow-2xl"><div className="w-7 h-7 rounded-lg bg-[#4D7CFF]/15 flex items-center justify-center flex-shrink-0"><CreditCard className="w-3.5 h-3.5 text-[#4D7CFF]" /></div><div><p className="text-[10px] text-[#4D7CFF]/70 font-medium">Pago recibido</p><p className="text-xs text-white/70 font-medium">MercadoPago · $12.400</p></div></div></div>)}
              {notifs.includes(3) && (<div className="absolute top-52 -left-3" style={{ animation: 'slide-in-notification 0.5s ease-out forwards' }}><div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#0d0d14]/90 border border-purple-500/15 backdrop-blur-xl shadow-2xl"><div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0"><Users className="w-3.5 h-3.5 text-purple-400" /></div><div><p className="text-[10px] text-purple-400/70 font-medium">Cliente nuevo</p><p className="text-xs text-white/70 font-medium">Laura Méndez registrada</p></div></div></div>)}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function StatsBar() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useMotionInView(ref, { once: true, margin: '-60px' });
  const stats = [
    { value: '2.400+', label: 'Pedidos procesados' },
    { value: '98%', label: 'Respuestas automáticas' },
    { value: '24/7', label: 'Atención continua' },
    { value: '<3s', label: 'Tiempo de respuesta' },
  ];

  return (
    <section ref={ref} className="relative py-16">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#4D7CFF]/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#4D7CFF]/20 to-transparent" />
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: i * 0.1 }} className="text-center">
              <div className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-[#00FFD1] via-[#4D7CFF] to-[#8B5CF6] bg-clip-text text-transparent mb-2">{s.value}</div>
              <p className="text-sm text-white/40">{s.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ f, index }: { f: typeof features[0]; index: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, []);

  return (
    <motion.div ref={cardRef} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: index * 0.1 }} whileHover={{ y: -4, transition: { duration: 0.2 } }} onMouseMove={handleMouseMove} className="group relative rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm p-6 hover:border-[#00FFD1]/20 transition-all duration-500 hover:shadow-2xl">
      <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'radial-gradient(300px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(0,255,209,0.08), transparent 60%)' }} />
      <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${f.color} opacity-0 group-hover:opacity-[0.03] transition-opacity duration-500`} />
      <motion.div initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 300, damping: 20, delay: index * 0.1 + 0.2 }} className={`relative w-12 h-12 rounded-xl ${f.bg} flex items-center justify-center mb-4`}>
        <f.icon className={`w-6 h-6 ${f.iconColor}`} />
      </motion.div>
      <h3 className="relative text-lg font-semibold text-white mb-2">{f.title}</h3>
      <p className="relative text-sm text-white/40 leading-relaxed">{f.description}</p>
    </motion.div>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="relative py-24 overflow-hidden">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#4D7CFF]/5 rounded-full blur-[120px]" />
      <div className="relative max-w-7xl mx-auto px-6">
        <Reveal>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#4D7CFF]/20 bg-[#4D7CFF]/5 text-xs text-[#4D7CFF] font-medium mb-4"><Zap className="w-3.5 h-3.5" />Funciones</div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">Todo lo que tu negocio necesita</h2>
            <p className="text-lg text-white/40 max-w-2xl mx-auto">Un ecosistema completo para gestionar ventas, clientes e inventario con inteligencia artificial.</p>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">{features.map((f, i) => <FeatureCard key={i} f={f} index={i} />)}</div>
      </div>
    </section>
  );
}

function AIShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useMotionInView(ref, { once: true, margin: '-100px' });
  const [visibleMessages, setVisibleMessages] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const timers = [
      setTimeout(() => setVisibleMessages(1), 300),
      setTimeout(() => setVisibleMessages(2), 1100),
      setTimeout(() => setVisibleMessages(3), 1900),
      setTimeout(() => setVisibleMessages(4), 2700),
      setTimeout(() => setVisibleMessages(5), 3500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isInView]);

  return (
    <section ref={ref} className="relative py-24 overflow-hidden">
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-600/5 rounded-full blur-[120px]" />
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <Reveal>
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-br from-emerald-500/10 to-transparent rounded-3xl blur-xl" />
              <div className="relative rounded-2xl border border-white/[0.10] bg-[#0d0d14]/90 backdrop-blur-xl overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#00FFD1]/40 to-transparent" />
                <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06] bg-emerald-500/5">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center"><Bot className="w-5 h-5 text-emerald-400" /></div>
                  <div><p className="text-sm font-semibold text-white">Nexova AI</p><p className="text-xs text-emerald-400">En línea</p></div>
                  <div className="ml-auto flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /><span className="text-xs text-emerald-400/60">activo</span></div>
                </div>
                <div className="p-5 space-y-4 min-h-[360px]">
                  {visibleMessages >= 1 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex justify-end">
                      <div className="max-w-[75%] rounded-2xl rounded-tr-md bg-[#4D7CFF]/15 border border-[#4D7CFF]/10 px-4 py-3"><p className="text-sm text-white/90">Hola, quiero pedir 2 cajas de Coca Cola 2L y 1 pack de agua mineral</p><span className="text-[10px] text-white/30 mt-1 block text-right">14:23</span></div>
                    </motion.div>
                  )}
                  {visibleMessages >= 2 && (
                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-1"><Bot className="w-3.5 h-3.5 text-emerald-400" /></div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04] w-fit"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /><span className="text-[11px] text-white/30 font-mono">search_products → 2 resultados</span></div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04] w-fit"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /><span className="text-[11px] text-white/30 font-mono">add_to_cart → OK</span></div>
                      </div>
                    </motion.div>
                  )}
                  {visibleMessages === 2 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2 items-center pl-9">
                      {[0, 1, 2].map((i) => <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#00FFD1]/40" style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', animationDelay: `${i * 200}ms` }} />)}
                    </motion.div>
                  )}
                  {visibleMessages >= 3 && (
                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-1"><Bot className="w-3.5 h-3.5 text-emerald-400" /></div>
                      <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/[0.06] px-4 py-3">
                        <p className="text-sm text-white/90 leading-relaxed">¡Perfecto! Te armé el pedido:<br /><br /><span className="text-white/60">2x</span> Coca Cola 2L — <span className="text-emerald-400 font-medium">$6.000</span><br /><span className="text-white/60">1x</span> Agua Mineral Pack x6 — <span className="text-emerald-400 font-medium">$4.800</span><br /><br /><span className="font-semibold text-white">Total: $10.800</span><br /><br />¿Confirmás el pedido?</p>
                        <span className="text-[10px] text-white/30 mt-1 block">14:23</span>
                      </div>
                    </motion.div>
                  )}
                  {visibleMessages >= 4 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex justify-end">
                      <div className="max-w-[75%] rounded-2xl rounded-tr-md bg-[#4D7CFF]/15 border border-[#4D7CFF]/10 px-4 py-3"><p className="text-sm text-white/90">Sí, confirmado!</p><span className="text-[10px] text-white/30 mt-1 block text-right">14:24</span></div>
                    </motion.div>
                  )}
                  {visibleMessages >= 5 && (
                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-1"><Bot className="w-3.5 h-3.5 text-emerald-400" /></div>
                      <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-emerald-500/5 border border-emerald-500/10 px-4 py-3"><p className="text-sm text-white/90">¡Pedido <span className="font-semibold text-emerald-400">ORD-00042</span> confirmado! Te avisamos cuando esté listo.</p><span className="text-[10px] text-white/30 mt-1 block">14:24</span></div>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>
          </Reveal>

          <div>
            <Reveal><div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400 font-medium mb-4"><Bot className="w-3.5 h-3.5" />Agente inteligente</div></Reveal>
            <Reveal delay={100}><h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">Un vendedor que nunca duerme</h2></Reveal>
            <Reveal delay={200}><p className="text-lg text-white/40 mb-8 leading-relaxed">Nuestro agente de IA entiende mensajes naturales, busca productos, arma pedidos, procesa comprobantes de pago y escala a humanos cuando es necesario. Todo en español argentino y de forma conversacional.</p></Reveal>
            <div className="space-y-4">
              {[
                { icon: MessageSquare, text: 'Entiende lenguaje natural en WhatsApp' },
                { icon: Receipt, text: 'Procesa comprobantes con visión IA' },
                { icon: Shield, text: 'Escala automáticamente ante problemas' },
                { icon: Clock, text: 'Responde en menos de 3 segundos' },
                { icon: Bell, text: 'Notifica al equipo en tiempo real' },
              ].map((item, i) => (
                <Reveal key={i} delay={300 + i * 80}>
                  <div className="flex items-center gap-3 group"><div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors"><item.icon className="w-4.5 h-4.5 text-emerald-400" /></div><span className="text-sm text-white/60 group-hover:text-white/80 transition-colors">{item.text}</span></div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AnalyticsSection() {
  return (
    <section className="relative py-24 overflow-hidden">
      <div className="absolute right-0 top-1/3 w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[120px]" />
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <Reveal><div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-500/20 bg-purple-500/5 text-xs text-purple-400 font-medium mb-4"><BarChart3 className="w-3.5 h-3.5" />Analytics</div></Reveal>
            <Reveal delay={100}><h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">Decisiones basadas en datos reales</h2></Reveal>
            <Reveal delay={200}><p className="text-lg text-white/40 mb-8 leading-relaxed">Dashboard de métricas en tiempo real con insights generados por IA. Entendé qué vende más, quiénes son tus mejores clientes y dónde está la oportunidad de crecer.</p></Reveal>
            <div className="space-y-4">
              {[
                { icon: TrendingUp, text: 'Tendencias de ventas diarias, semanales y mensuales' },
                { icon: Sparkles, text: 'Insights y recomendaciones generados por IA' },
                { icon: Users, text: 'Ranking de clientes por facturación y frecuencia' },
                { icon: FileText, text: 'Facturación electrónica ARCA/AFIP integrada' },
              ].map((item, i) => (
                <Reveal key={i} delay={300 + i * 80}>
                  <div className="flex items-center gap-3 group"><div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors"><item.icon className="w-4.5 h-4.5 text-purple-400" /></div><span className="text-sm text-white/60 group-hover:text-white/80 transition-colors">{item.text}</span></div>
                </Reveal>
              ))}
            </div>
          </div>

          <Reveal delay={200}>
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <div><p className="text-sm font-medium text-white">Crecimiento mensual</p><p className="text-xs text-white/30">Comparado con el período anterior</p></div>
                  <div className="flex items-center gap-4 text-xs"><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#00FFD1]" /><span className="text-white/40">Actual</span></span><span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-white/10" /><span className="text-white/40">Anterior</span></span></div>
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyGrowth} barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="name" stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 12 }} />
                      <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
                      <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '13px' }} labelStyle={{ color: 'rgba(255,255,255,0.5)' }} itemStyle={{ color: 'rgba(255,255,255,0.8)' }} formatter={(value) => [`$${(Number(value) / 100).toLocaleString('es-AR')}`, '']} />
                      <Bar dataKey="anterior" fill="rgba(255,255,255,0.06)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="actual" fill="#00FFD1" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-sm p-5">
                  <p className="text-sm font-medium text-white mb-3">Cobros por método</p>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={paymentMethodData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={4} dataKey="value" strokeWidth={0}>{paymentMethodData.map((entry, index) => <Cell key={index} fill={entry.color} />)}</Pie><Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '13px' }} labelStyle={{ color: 'rgba(255,255,255,0.5)' }} itemStyle={{ color: 'rgba(255,255,255,0.8)' }} formatter={(value) => [`${value}%`, '']} /></PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 mt-2">{paymentMethodData.map((c, i) => (<div key={i} className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c.color }} /><span className="text-white/40">{c.name}</span></span><span className="text-white/60 font-medium">{c.value}%</span></div>))}</div>
                </div>

                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.04] backdrop-blur-sm p-5 flex flex-col justify-between">
                  <div><p className="text-sm font-medium text-white mb-1">Insight IA</p><div className="flex items-center gap-1 mb-3"><Sparkles className="w-3 h-3 text-purple-400" /><span className="text-[11px] text-purple-400 font-medium">Generado automáticamente</span></div></div>
                  <div className="space-y-3">
                    <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10"><p className="text-[11px] text-emerald-400/70 mb-0.5">Oportunidad</p><p className="text-xs text-white/60">Los sábados representan un 22% de las ventas semanales. Considerá ampliar stock.</p></div>
                    <div className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10"><p className="text-[11px] text-amber-400/70 mb-0.5">Riesgo</p><p className="text-xs text-white/60">3 productos con stock bajo necesitan reposición esta semana.</p></div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function SolutionsSection() {
  return (
    <section id="solutions" className="relative py-24 overflow-hidden">
      <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-[800px] h-[400px] bg-[#4D7CFF]/5 rounded-full blur-[120px]" />
      <div className="relative max-w-7xl mx-auto px-6">
        <Reveal>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#4D7CFF]/20 bg-[#4D7CFF]/5 text-xs text-[#4D7CFF] font-medium mb-4"><Globe className="w-3.5 h-3.5" />Soluciones</div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">Diseñado para tu industria</h2>
            <p className="text-lg text-white/40 max-w-2xl mx-auto">No importa el tamaño de tu negocio. Nexova se adapta a tus necesidades.</p>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6">
          {solutions.map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: i * 0.12 }} whileHover={{ y: -4, transition: { duration: 0.2 } }} className="group relative h-full rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm p-7 hover:border-[#00FFD1]/20 transition-all duration-500">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#00FFD1]/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-[#4D7CFF]/10 flex items-center justify-center mb-5"><s.icon className="w-7 h-7 text-[#4D7CFF]" /></div>
                <h3 className="text-xl font-semibold text-white mb-3">{s.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed mb-5">{s.description}</p>
                <ul className="space-y-2.5">{s.items.map((item, j) => <li key={j} className="flex items-center gap-2.5 text-sm text-white/50"><Check className="w-4 h-4 text-[#4D7CFF] flex-shrink-0" />{item}</li>)}</ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="pricing" className="relative py-24 overflow-hidden">
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-[#4D7CFF]/5 rounded-full blur-[120px]" />
      <div className="relative max-w-7xl mx-auto px-6">
        <Reveal>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#4D7CFF]/20 bg-[#4D7CFF]/5 text-xs text-[#4D7CFF] font-medium mb-4"><CreditCard className="w-3.5 h-3.5" />Precios</div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">Simple y transparente</h2>
            <p className="text-lg text-white/40 max-w-2xl mx-auto">Sin sorpresas. Elegí el plan que mejor se adapte a tu negocio. Todos incluyen 14 días de prueba gratis.</p>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((p, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: i * 0.12 }} whileHover={{ y: -6, boxShadow: p.highlighted ? '0 25px 60px -12px rgba(0,255,209,0.2), 0 0 40px rgba(139,92,246,0.15)' : '0 25px 60px -12px rgba(0,0,0,0.3)', transition: { duration: 0.2 } }} className={`relative h-full rounded-2xl border p-7 transition-colors duration-500 flex flex-col ${p.highlighted ? 'gradient-border border-transparent bg-gradient-to-b from-white/[0.06] to-transparent shadow-2xl shadow-[#8B5CF6]/10' : 'border-white/[0.08] bg-white/[0.04] hover:border-white/[0.15]'}`}>
              {p.highlighted && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-[#00FFD1] to-[#4D7CFF] text-xs font-semibold text-white shadow-lg shadow-[#00FFD1]/30">Más popular</div>}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-1">{p.name}</h3>
                <p className="text-sm text-white/30 mb-4">{p.description}</p>
                <div className="flex items-baseline gap-1"><span className="text-sm text-white/40">USD</span><span className={`text-4xl font-bold ${p.highlighted ? 'bg-gradient-to-r from-[#00FFD1] to-[#8B5CF6] bg-clip-text text-transparent' : 'text-white'}`}>{p.price}</span><span className="text-sm text-white/40">{p.period}</span></div>
              </div>
              <ul className="space-y-3 mb-8 flex-1">{p.features.map((f, j) => <li key={j} className="flex items-start gap-2.5 text-sm text-white/50"><Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${p.highlighted ? 'text-[#4D7CFF]' : 'text-white/20'}`} />{f}</li>)}</ul>
              <a href={`/cart?plan=${encodeURIComponent(p.code)}`} className={`group relative w-full py-3 rounded-xl text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2 overflow-hidden ${p.highlighted ? 'text-white shadow-lg shadow-[#00FFD1]/20 hover:shadow-[#00FFD1]/35' : 'border border-white/10 text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.03]'}`} style={p.highlighted ? { background: 'linear-gradient(90deg, #00FFD1, #4D7CFF, #8B5CF6)', backgroundSize: '200% 100%', animation: 'gradient-shift 4s ease-in-out infinite' } : undefined}>
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <span className="relative">{p.cta}</span>
                <ArrowRight className="relative w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  const doubled = [...testimonials, ...testimonials];
  return (
    <section className="relative py-24 overflow-hidden">
      <div className="relative max-w-7xl mx-auto px-6">
        <Reveal>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 text-xs text-amber-400 font-medium mb-4"><Star className="w-3.5 h-3.5" />Testimonios</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Lo que dicen nuestros clientes</h2>
          </div>
        </Reveal>
      </div>

      {/* Marquee row 1 */}
      <div className="relative mb-4">
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#08080d] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#08080d] to-transparent z-10 pointer-events-none" />
        <div className="flex gap-4 hover:[animation-play-state:paused]" style={{ animation: 'marquee 40s linear infinite', width: 'max-content' }}>
          {doubled.map((t, i) => (
            <div key={i} className="w-[360px] flex-shrink-0 rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#4D7CFF]/30 to-transparent" />
              <div className="flex gap-0.5 mb-4">{Array.from({ length: t.stars }).map((_, j) => <Star key={j} className="w-4 h-4 text-amber-400 fill-amber-400" />)}</div>
              <p className="text-sm text-white/50 leading-relaxed mb-5 italic">"{t.text}"</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4D7CFF]/30 to-purple-500/30 flex items-center justify-center"><span className="text-sm font-semibold text-white">{t.name[0]}</span></div>
                <div><p className="text-sm font-medium text-white">{t.name}</p><p className="text-xs text-white/30">{t.role}</p></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Marquee row 2 (reverse) */}
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[#08080d] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[#08080d] to-transparent z-10 pointer-events-none" />
        <div className="flex gap-4 hover:[animation-play-state:paused]" style={{ animation: 'marquee 40s linear infinite reverse', width: 'max-content' }}>
          {[...doubled].reverse().map((t, i) => (
            <div key={i} className="w-[360px] flex-shrink-0 rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#4D7CFF]/30 to-transparent" />
              <div className="flex gap-0.5 mb-4">{Array.from({ length: t.stars }).map((_, j) => <Star key={j} className="w-4 h-4 text-amber-400 fill-amber-400" />)}</div>
              <p className="text-sm text-white/50 leading-relaxed mb-5 italic">"{t.text}"</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4D7CFF]/30 to-purple-500/30 flex items-center justify-center"><span className="text-sm font-semibold text-white">{t.name[0]}</span></div>
                <div><p className="text-sm font-medium text-white">{t.name}</p><p className="text-xs text-white/30">{t.role}</p></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <section id="faq" className="relative py-24 overflow-hidden">
      <div className="relative max-w-3xl mx-auto px-6">
        <Reveal>
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-xs text-white/50 font-medium mb-4">Preguntas frecuentes</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">¿Tenés dudas?</h2>
          </div>
        </Reveal>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-20px' }} transition={{ duration: 0.4, delay: i * 0.06 }} className={`rounded-2xl border transition-colors duration-300 overflow-hidden relative ${openIndex === i ? 'border-[#00FFD1]/20 bg-[#00FFD1]/[0.03]' : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.12]'}`}>
              {openIndex === i && <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#00FFD1] via-[#4D7CFF] to-[#8B5CF6]" />}
              <button className="w-full flex items-center justify-between p-5 text-left" onClick={() => setOpenIndex(openIndex === i ? null : i)}>
                <span className="text-sm font-medium text-white pr-4">{faq.q}</span>
                <motion.div animate={{ rotate: openIndex === i ? 180 : 0 }} transition={{ duration: 0.3 }}><ChevronDown className={`w-5 h-5 flex-shrink-0 transition-colors duration-300 ${openIndex === i ? 'text-[#00FFD1]' : 'text-white/30'}`} /></motion.div>
              </button>
              <AnimatePresence initial={false}>
                {openIndex === i && (
                  <motion.div key="content" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }} className="overflow-hidden">
                    <p className="px-5 pb-5 text-sm text-white/40 leading-relaxed">{faq.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="relative py-24 overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute w-[600px] h-[600px] bg-[#00FFD1]/[0.30] rounded-full blur-[140px] top-[-20%] left-[10%]" style={{ animation: 'float 12s ease-in-out infinite' }} />
        <div className="absolute w-[500px] h-[500px] bg-[#8B5CF6]/[0.35] rounded-full blur-[130px] bottom-[-10%] right-[10%]" style={{ animation: 'float 10s ease-in-out infinite reverse' }} />
        <div className="absolute w-[400px] h-[400px] bg-[#EC4899]/[0.20] rounded-full blur-[120px] top-[30%] right-[30%]" style={{ animation: 'float 14s ease-in-out infinite', animationDelay: '3s' }} />
        <div className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-[#00FFD1]/40 blur-[1px]" style={{ animation: 'float 8s ease-in-out infinite' }} />
        <div className="absolute top-1/3 right-1/3 w-2 h-2 rounded-full bg-white/25 blur-[1px]" style={{ animation: 'float 10s ease-in-out infinite reverse' }} />
        <div className="absolute bottom-1/3 left-1/3 w-2.5 h-2.5 rounded-full bg-[#4D7CFF]/40 blur-[1px]" style={{ animation: 'float 12s ease-in-out infinite', animationDelay: '2s' }} />
        <div className="absolute top-1/2 right-1/4 w-1.5 h-1.5 rounded-full bg-[#EC4899]/35 blur-[1px]" style={{ animation: 'float 9s ease-in-out infinite', animationDelay: '4s' }} />
        <div className="absolute top-2/3 left-[15%] w-2 h-2 rounded-full bg-[#8B5CF6]/35 blur-[1px]" style={{ animation: 'float 11s ease-in-out infinite', animationDelay: '1s' }} />
        <div className="absolute top-[20%] right-[15%] w-1.5 h-1.5 rounded-full bg-[#00FFD1]/30 blur-[1px]" style={{ animation: 'float 7s ease-in-out infinite', animationDelay: '3s' }} />
      </div>
      <div className="relative max-w-4xl mx-auto px-6 text-center">
        <Reveal><h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6">Llevá tu negocio al siguiente nivel</h2></Reveal>
        <Reveal delay={100}><p className="text-lg text-white/50 mb-10 max-w-2xl mx-auto">Sumate a los comercios que ya usan inteligencia artificial para vender más, atender mejor y crecer sin límites.</p></Reveal>
        <Reveal delay={200}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/cart?plan=standard" className="group relative flex items-center gap-2 text-white font-medium px-8 py-4 rounded-2xl text-base transition-all duration-300 shadow-[0_0_50px_rgba(0,255,209,0.3)] hover:shadow-[0_0_70px_rgba(0,255,209,0.4)] hover:-translate-y-0.5 overflow-hidden" style={{ background: 'linear-gradient(90deg, #00FFD1, #4D7CFF, #8B5CF6)', backgroundSize: '200% 100%', animation: 'gradient-shift 4s ease-in-out infinite' }}>
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <span className="relative">Empezar ahora — Es gratis</span>
              <ArrowRight className="relative w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function NewsletterSection() {
  const [email, setEmail] = useState('');
  return (
    <section className="relative py-16 border-t border-white/[0.04]">
      <div className="max-w-2xl mx-auto px-6 text-center">
        <Reveal>
          <div className="flex items-center justify-center gap-2 mb-3"><Send className="w-4 h-4 text-[#4D7CFF]" /><span className="text-sm font-medium text-white/50">Newsletter</span></div>
          <h3 className="text-xl font-semibold text-white mb-2">Novedades y tips para tu negocio</h3>
          <p className="text-sm text-white/30 mb-6">Recibí actualizaciones sobre nuevas funciones, guías y mejores prácticas. Sin spam.</p>
        </Reveal>
        <Reveal delay={100}>
          <form className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto" onSubmit={(e) => e.preventDefault()}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" className="flex-1 h-12 px-4 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#4D7CFF]/40 focus:ring-1 focus:ring-[#4D7CFF]/20 transition-all" />
            <button type="submit" className="h-12 px-6 bg-[#4D7CFF] hover:bg-[#3D6BEE] text-white text-sm font-medium rounded-xl transition-all duration-200 shadow-lg shadow-[#4D7CFF]/20 whitespace-nowrap">Suscribirme</button>
          </form>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  const links = {
    Producto: [{ label: 'Funciones', href: '#features' }, { label: 'Precios', href: '#pricing' }, { label: 'Soluciones', href: '#solutions' }, { label: 'FAQ', href: '#faq' }],
    Empresa: [{ label: 'Nosotros', href: '#' }, { label: 'Blog', href: '#' }, { label: 'Contacto', href: '#' }],
    Legal: [{ label: 'Términos de servicio', href: '#' }, { label: 'Política de privacidad', href: '#' }],
  };

  return (
    <footer className="relative py-16">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#4D7CFF]/20 to-transparent" />
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10 mb-12">
          <div className="sm:col-span-2 md:col-span-1">
            <NexovaLogo className="h-5 w-auto mb-4" fill="rgba(255,255,255,0.4)" />
            <p className="text-sm text-white/30 leading-relaxed">Plataforma de commerce inteligente con IA para negocios que quieren crecer.</p>
          </div>
          {Object.entries(links).map(([title, items]) => (
            <div key={title}>
              <p className="text-sm font-medium text-white/60 mb-4">{title}</p>
              <ul className="space-y-2.5">{items.map((item) => <li key={item.label}><a href={item.href} className="text-sm text-white/30 hover:text-white/60 transition-colors">{item.label}</a></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between pt-8 border-t border-white/[0.04] gap-4">
          <p className="text-xs text-white/20">&copy; {year} Nexova. Todos los derechos reservados.</p>
          <div className="flex items-center gap-4"><span className="text-xs text-white/20">Hecho con IA en Argentina</span></div>
        </div>
      </div>
    </footer>
  );
}

/* ───────────────────────── MAIN ───────────────────────── */

export default function IndexPage() {
  return (
    <div className="min-h-screen bg-[#08080d] text-white font-sans antialiased overflow-x-hidden" style={{ scrollBehavior: 'smooth' }}>
      <Navbar />
      <HeroSection />
      <StatsBar />
      <FeaturesSection />
      <AIShowcase />
      <AnalyticsSection />
      <SolutionsSection />
      <PricingSection />
      <TestimonialsSection />
      <FAQSection />
      <CTASection />
      <NewsletterSection />
      <Footer />
    </div>
  );
}
