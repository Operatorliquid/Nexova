import { motion, type MotionValue, useTransform } from 'motion/react';
import {
    LayoutDashboard,
    MessageSquare,
    Package,
    FileText,
    Users,
    Settings,
    Bell,
    Search,
    ArrowUpRight,
    ArrowDownRight,
    Activity,
    CreditCard,
    DollarSign
} from 'lucide-react';

interface HeroDashboardMockupProps {
    progress: MotionValue<number>;
    startRange: number;
    endRange: number;
}

export default function HeroDashboardMockup({ progress, startRange, endRange }: HeroDashboardMockupProps) {
    // Exit animations mapping scroll progress to component properties. 
    // It is fully visible at startRange (e.g. 0), and fades out/moves at endRange.
    const y = useTransform(progress, [startRange, endRange], [0, 200]);
    const opacity = useTransform(progress, [startRange, endRange], [1, 0]);
    const scale = useTransform(progress, [startRange, endRange], [1, 0.95]);
    const rotateX = useTransform(progress, [startRange, endRange], [0, 10]);

    return (
        <motion.div
            style={{
                y,
                opacity,
                scale,
                rotateX,
                perspective: 1000,
                transformStyle: 'preserve-3d'
            }}
            className="w-full max-w-6xl mx-auto rounded-3xl overflow-hidden border border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.8)] flex bg-[#09090b] text-white select-none backdrop-blur-xl"
        >
            {/* Sidebar */}
            <aside className="w-64 border-r border-white/5 p-6 flex-shrink-0 hidden md:flex flex-col bg-white/[0.02]">
                <div className="flex items-center gap-3 mb-10">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#ff4200] to-orange-600 flex items-center justify-center">
                        <span className="font-bold text-lg leading-none">N</span>
                    </div>
                    <span className="font-semibold tracking-wide text-lg">Nexova</span>
                </div>

                <nav className="flex-1 space-y-2">
                    <div className="px-4 py-3 bg-white/10 rounded-xl flex items-center gap-3 text-white">
                        <LayoutDashboard size={18} />
                        <span className="font-medium text-sm">Dashboard</span>
                    </div>
                    {[
                        { icon: MessageSquare, label: 'Mensajes' },
                        { icon: Package, label: 'Productos' },
                        { icon: FileText, label: 'Facturación' },
                        { icon: Users, label: 'Clientes' },
                    ].map((item, idx) => (
                        <div key={idx} className="px-4 py-3 hover:bg-white/5 rounded-xl flex items-center gap-3 text-zinc-400 hover:text-white transition-colors">
                            <item.icon size={18} />
                            <span className="font-medium text-sm">{item.label}</span>
                        </div>
                    ))}
                </nav>

                <div className="mt-8 pt-8 border-t border-white/5">
                    <div className="px-4 py-3 hover:bg-white/5 rounded-xl flex items-center gap-3 text-zinc-400 hover:text-white transition-colors mb-4">
                        <Settings size={18} />
                        <span className="font-medium text-sm">Ajustes</span>
                    </div>
                    <div className="flex items-center gap-3 px-2">
                        <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=100&auto=format&fit=crop" alt="User" className="w-10 h-10 rounded-full object-cover border border-white/20" />
                        <div>
                            <p className="text-sm font-medium">Sofia R.</p>
                            <p className="text-xs text-zinc-500">sofia@nexova.com</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-h-[600px] relative">
                {/* Abstract Background Elements */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#ff4200]/5 rounded-full blur-[120px] rounded-full pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px] rounded-full pointer-events-none" />

                {/* Header */}
                <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 bg-white/[0.01] backdrop-blur-md sticky top-0 z-10">
                    <div className="text-xl font-medium tracking-tight">Overview</div>
                    <div className="flex items-center gap-6">
                        <div className="relative hidden sm:flex items-center">
                            <Search size={16} className="absolute left-3 text-zinc-500" />
                            <input type="text" placeholder="Buscar..." className="bg-white/5 border border-white/10 rounded-full pl-10 pr-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#ff4200]/50 w-64 transition-colors" />
                        </div>
                        <button className="relative text-zinc-400 hover:text-white transition-colors">
                            <Bell size={20} />
                            <span className="absolute 0 right-0 w-2 h-2 bg-[#ff4200] rounded-full" />
                        </button>
                    </div>
                </header>

                {/* Dashboard Content */}
                <div className="flex-1 p-8 overflow-y-auto relative z-10">

                    {/* Top Metrics Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 hover:bg-white/[0.05] transition-colors relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-[#ff4200]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-zinc-400 text-sm font-medium flex items-center gap-2"><DollarSign size={16} /> Ingresos Totales</span>
                                <span className="flex items-center text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full text-xs font-semibold">
                                    <ArrowUpRight size={14} className="mr-1" /> +12.5%
                                </span>
                            </div>
                            <div className="text-4xl font-light tracking-tight">$45,231.89</div>
                            <p className="text-zinc-500 text-xs mt-2 font-medium">vs mes pasado ($40,200.00)</p>
                        </div>

                        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 hover:bg-white/[0.05] transition-colors relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-zinc-400 text-sm font-medium flex items-center gap-2"><Users size={16} /> Nuevos Clientes</span>
                                <span className="flex items-center text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full text-xs font-semibold">
                                    <ArrowUpRight size={14} className="mr-1" /> +5.2%
                                </span>
                            </div>
                            <div className="text-4xl font-light tracking-tight">+354</div>
                            <p className="text-zinc-500 text-xs mt-2 font-medium">12 pagos pendientes</p>
                        </div>

                        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 hover:bg-white/[0.05] transition-colors relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-zinc-400 text-sm font-medium flex items-center gap-2"><Activity size={16} /> Ventas Activas</span>
                                <span className="flex items-center text-rose-400 bg-rose-400/10 px-2 py-1 rounded-full text-xs font-semibold">
                                    <ArrowDownRight size={14} className="mr-1" /> -1.1%
                                </span>
                            </div>
                            <div className="text-4xl font-light tracking-tight">128</div>
                            <p className="text-zinc-500 text-xs mt-2 font-medium">45 completadas hoy</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Chart Simulation */}
                        <div className="lg:col-span-2 bg-white/[0.03] border border-white/10 rounded-2xl p-6 flex flex-col relative overflow-hidden">
                            <div className="flex items-center justify-between mb-8">
                                <h3 className="font-medium">Crecimiento de Ingresos</h3>
                                <div className="flex gap-2">
                                    {['1W', '1M', '3M', '1Y'].map((t, i) => (
                                        <button key={i} className={`px-3 py-1 text-xs rounded-full font-medium ${i === 1 ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}>
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Mock Chart Area */}
                            <div className="flex-1 mt-auto h-48 flex items-end justify-between gap-2 px-2 relative">
                                {/* Chart Grid Lines */}
                                <div className="absolute inset-x-0 bottom-0 h-full flex flex-col justify-between pointer-events-none opacity-10">
                                    <div className="border-b border-white w-full h-[1px]"></div>
                                    <div className="border-b border-white w-full h-[1px]"></div>
                                    <div className="border-b border-white w-full h-[1px]"></div>
                                    <div className="border-b border-white w-full h-[1px]"></div>
                                </div>

                                {/* Chart Bars */}
                                {[40, 60, 45, 80, 50, 90, 75, 100, 85, 110, 95, 120].map((h, i) => (
                                    <div key={i} className="w-full bg-gradient-to-t from-[#ff4200]/20 to-[#ff4200] rounded-t-sm" style={{ height: `${(h / 120) * 100}%`, opacity: 0.8 + (i * 0.02) }}>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Recent Activity */}
                        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6">
                            <h3 className="font-medium mb-6">Actividad Reciente</h3>
                            <div className="space-y-6">
                                {[
                                    { name: 'Maria L.', action: 'Nuevo pedido #2349', time: 'Hace 5 min', icon: Package, color: 'text-blue-400', bg: 'bg-blue-400/10' },
                                    { name: 'Juan P.', action: 'Pago recibido $120.00', time: 'Hace 20 min', icon: CreditCard, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                                    { name: 'Sofia R.', action: 'Factura generada', time: 'Hace 1 hora', icon: FileText, color: 'text-purple-400', bg: 'bg-purple-400/10' },
                                    { name: 'Lucas G.', action: 'Mensaje de soporte', time: 'Hace 2 horas', icon: MessageSquare, color: 'text-[#ff4200]', bg: 'bg-[#ff4200]/10' },
                                ].map((item, i) => (
                                    <div key={i} className="flex gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${item.bg} ${item.color}`}>
                                            <item.icon size={18} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">{item.name}</p>
                                            <p className="text-sm text-zinc-400">{item.action}</p>
                                            <p className="text-xs text-zinc-600 mt-1">{item.time}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </motion.div>
    );
}
