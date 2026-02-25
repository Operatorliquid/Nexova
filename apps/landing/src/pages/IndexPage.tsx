import { type LucideIcon, Apple, Play, ArrowDown, CheckCircle2, MessageCircle, BarChart3, Zap, Shield, Smartphone, Globe } from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { Fragment, useRef } from 'react';

type StoreButtonProps = {
  icon: LucideIcon;
  store: string;
  topText: string;
};

function StoreButton({ icon: Icon, store, topText }: StoreButtonProps): JSX.Element {
  return (
    <button className="flex items-center gap-3 bg-black text-white hover:bg-[#1a1a1a] transition-all px-6 py-3.5 rounded-2xl shadow-xl hover:shadow-2xl hover:-translate-y-1" type="button">
      <Icon className="w-8 h-8" />
      <div className="text-left">
        <span className="block text-[9px] font-bold uppercase tracking-[0.15em] text-white/70">{topText}</span>
        <span className="block text-base font-semibold leading-tight">{store}</span>
      </div>
    </button>
  );
}

export default function IndexPage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const heroRef = useRef<HTMLElement | null>(null);
  const stickyRef = useRef<HTMLElement | null>(null);
  const cardsRef = useRef<HTMLElement | null>(null);
  const reasonalRef = useRef<HTMLElement | null>(null);

  const { scrollYProgress: heroScroll } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const phoneFrontY = useTransform(heroScroll, [0, 1], [0, 300]);
  const phoneFrontRotate = useTransform(heroScroll, [0, 1], [-12, -20]);
  const phoneBackY = useTransform(heroScroll, [0, 1], [50, 150]);
  const phoneBackRotate = useTransform(heroScroll, [0, 1], [10, 25]);
  const heroTextY = useTransform(heroScroll, [0, 1], [0, 150]);
  const heroOpacity = useTransform(heroScroll, [0, 0.8], [1, 0]);

  const { scrollYProgress: stickyProgress } = useScroll({
    target: stickyRef,
    offset: ['start start', 'end end'],
  });
  const step1Opacity = useTransform(stickyProgress, [0, 0.2, 0.3], [1, 1, 0]);
  const step2Opacity = useTransform(stickyProgress, [0.25, 0.4, 0.6, 0.7], [0, 1, 1, 0]);
  const step3Opacity = useTransform(stickyProgress, [0.65, 0.8, 1], [0, 1, 1]);
  const mockupsY = useTransform(stickyProgress, [0, 0.8], ['0%', '-66.66%']);

  const { scrollYProgress: cardsProgress } = useScroll({
    target: cardsRef,
    offset: ['start end', 'end start'],
  });
  const card1Y = useTransform(cardsProgress, [0, 1], [250, -150]);
  const card2Y = useTransform(cardsProgress, [0, 1], [400, -50]);
  const card3Y = useTransform(cardsProgress, [0, 1], [300, -250]);

  const { scrollYProgress: reasonalProgress } = useScroll({
    target: reasonalRef,
    offset: ['start end', 'end start'],
  });
  const rEl1 = useTransform(reasonalProgress, [0, 1], [150, -200]);
  const rEl2 = useTransform(reasonalProgress, [0, 1], [300, -100]);
  const rEl3 = useTransform(reasonalProgress, [0, 1], [50, -300]);
  const rEl4 = useTransform(reasonalProgress, [0, 1], [250, -150]);
  const rEl5 = useTransform(reasonalProgress, [0, 1], [350, -50]);

  return (
    <div
      ref={containerRef}
      className="bg-[#cc1100] text-white min-h-screen font-sans overflow-x-hidden selection:bg-black selection:text-white"
    >
      <nav className="fixed top-0 w-full z-50 p-6 lg:px-12 backdrop-blur-sm bg-gradient-to-b from-black/20 to-transparent">
        <div className="max-w-[1400px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2 font-bold text-2xl tracking-tighter">
            <div className="w-8 h-8 bg-white text-red-600 rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-xl">N</span>
            </div>
            Nexova
          </div>
          <div className="hidden lg:flex gap-10 text-[13px] font-bold tracking-widest uppercase text-white/90">
            <a href="#" className="hover:text-white transition-colors">
              Vision
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Sistema
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Impacto
            </a>
          </div>
          <div className="flex items-center gap-4">
            <button
              className="bg-white/10 hover:bg-white/20 border border-white/20 px-6 py-2.5 rounded-full text-sm font-bold transition-all backdrop-blur-md"
              type="button"
            >
              Acceso
            </button>
          </div>
        </div>
      </nav>

      <section
        ref={heroRef}
        className="relative min-h-[120vh] w-full pt-32 lg:pt-40 overflow-hidden flex flex-col items-center"
      >
        <div className="absolute inset-0 z-0 pointer-events-none bg-[#cc1100]">
          <motion.div
            animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }}
            transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
            className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] rounded-full bg-[#ff4d00] mix-blend-screen opacity-70 blur-[130px]"
          />
          <motion.div
            animate={{ scale: [1, 1.3, 1], x: [0, -100, 0] }}
            transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute bottom-[-10%] right-[-10%] w-[80vw] h-[80vw] rounded-full bg-[#ff8800] mix-blend-screen opacity-50 blur-[160px]"
          />
          <div className="absolute top-[30%] left-[30%] w-[40vw] h-[40vw] rounded-full bg-[#800000] mix-blend-multiply opacity-80 blur-[120px]" />
        </div>

        <motion.div
          style={{ y: heroTextY, opacity: heroOpacity }}
          className="relative z-10 w-full max-w-[1400px] mx-auto px-6 lg:px-12 grid lg:grid-cols-2 gap-12 items-center flex-1"
        >
          <div className="flex flex-col gap-8 lg:pr-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 mb-8">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase">Agente IA en linea</span>
              </div>
              <h1 className="text-[4.5rem] lg:text-[7.5rem] font-medium tracking-tight leading-[0.9] mb-6">
                Revolucion en <br />
                tu bolsillo.
              </h1>
              <p className="text-[18px] lg:text-[20px] font-light text-white/80 max-w-lg leading-relaxed">
                Joyas locales. Marcas con proposito. Un ecosistema inteligente que transforma tu
                WhatsApp en una maquina de ventas 24/7.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="flex flex-wrap gap-4 mt-4"
            >
              <StoreButton icon={Apple} store="App Store" topText="Consiguelo en el" />
              <StoreButton icon={Play} store="Google Play" topText="Disponible en" />
            </motion.div>
          </div>

          <div className="relative h-[700px] lg:h-[850px] w-full flex justify-center items-center perspective-[2000px] mt-20 lg:mt-0">
            <motion.div
              style={{ y: phoneBackY, rotateZ: phoneBackRotate, rotateX: 5, rotateY: 15 }}
              className="absolute right-[0%] lg:right-[10%] top-[10%] w-[320px] lg:w-[360px] h-[640px] lg:h-[720px] bg-[#E5B869] rounded-[48px] border-[12px] border-[#c09955] shadow-[0_30px_60px_rgba(0,0,0,0.6)] overflow-hidden z-10"
            >
              <div className="w-full h-full bg-[#111] relative overflow-hidden flex flex-col pt-16">
                <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[120px] h-[35px] bg-black rounded-full z-30" />
                <div className="p-6">
                  <h3 className="text-white text-3xl font-bold mb-2">Resumen</h3>
                  <p className="text-gray-400 text-sm mb-8">Ventas generadas por IA</p>

                  <div className="w-full aspect-square bg-gradient-to-br from-yellow-500/20 to-yellow-900/40 rounded-full border-4 border-yellow-600/30 flex items-center justify-center mb-8 relative">
                    <div className="absolute inset-4 border-2 border-dashed border-yellow-500/50 rounded-full animate-[spin_20s_linear_infinite]" />
                    <div className="text-center">
                      <p className="text-yellow-500 text-sm font-bold tracking-widest uppercase mb-1">
                        Total
                      </p>
                      <p className="text-white text-5xl font-bold">$12.4k</p>
                    </div>
                  </div>

                  <div className="bg-white/5 rounded-2xl p-4 border border-white/10 backdrop-blur-md">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-white/60 text-sm">Conversion</span>
                      <span className="text-green-400 font-bold">+14%</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full w-[78%] bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              style={{ y: phoneFrontY, rotateZ: phoneFrontRotate, rotateX: 5, rotateY: -10 }}
              className="absolute left-[0%] lg:left-[15%] top-[15%] w-[340px] lg:w-[380px] h-[680px] lg:h-[760px] bg-[#2A0808] rounded-[50px] border-[14px] border-[#902A22] shadow-[-40px_40px_80px_rgba(0,0,0,0.7)] overflow-hidden z-20"
            >
              <div className="w-full h-full relative overflow-hidden bg-white">
                <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[120px] h-[35px] bg-black rounded-full z-30" />

                <div className="h-[75%] w-full relative">
                  <img
                    src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=800&auto=format&fit=crop"
                    className="w-full h-full object-cover filter contrast-125 brightness-75 sepia-[0.5] hue-rotate-[-30deg]"
                    alt="Silhouette"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#cc1100] via-[#cc1100]/60 to-transparent" />

                  <div className="absolute bottom-8 w-full flex flex-col items-center">
                    <div className="w-20 h-20 bg-white rounded-full mb-4 shadow-[0_0_40px_rgba(255,255,255,0.4)] flex items-center justify-center">
                      <span className="text-[#cc1100] text-3xl font-black">N</span>
                    </div>
                    <p className="text-[11px] font-bold tracking-widest uppercase text-white/80 mb-2">
                      Agente Nexova
                    </p>
                    <h2 className="text-3xl font-bold text-white mb-6">En linea</h2>

                    <div className="flex gap-4">
                      <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center">
                        <MessageCircle className="w-6 h-6 text-white" />
                      </div>
                      <div className="w-14 h-14 rounded-full bg-black flex items-center justify-center shadow-2xl">
                        <Zap className="w-6 h-6 text-yellow-400" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-[25%] bg-white w-full rounded-t-[2.5rem] -mt-8 relative z-10 p-6 flex flex-col justify-center border-t-4 border-white">
                  <div className="bg-gray-100 rounded-2xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#cc1100] rounded-full flex items-center justify-center">
                        <Apple className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-black font-bold text-sm">Pago recibido</p>
                        <p className="text-gray-500 text-xs">Hace 2 minutos</p>
                      </div>
                    </div>
                    <p className="text-black font-bold text-lg">+$145</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="absolute bottom-10 left-6 lg:left-12 flex items-center gap-3 text-[13px] font-bold uppercase tracking-[0.2em] opacity-80 z-20"
        >
          <ArrowDown className="w-4 h-4 animate-bounce" /> Haz scroll
        </motion.div>
      </section>

      <div className="w-full py-6 bg-black border-y border-white/10 overflow-hidden relative z-20 flex items-center">
        <div className="absolute left-0 w-40 h-full bg-gradient-to-r from-black to-transparent z-10" />
        <div className="absolute right-0 w-40 h-full bg-gradient-to-l from-black to-transparent z-10" />
        <motion.div
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          className="flex whitespace-nowrap gap-16 px-10 items-center opacity-40 font-bold text-2xl tracking-[0.2em] uppercase"
        >
          {[...Array(4)].map((_, i) => (
            <Fragment key={i}>
              <span>Shopify</span>
              <span className="text-red-600">✦</span>
              <span>MercadoPago</span>
              <span className="text-red-600">✦</span>
              <span>WhatsApp API</span>
              <span className="text-red-600">✦</span>
              <span>Stripe</span>
              <span className="text-red-600">✦</span>
            </Fragment>
          ))}
        </motion.div>
      </div>

      <section className="bg-[#F8F8F8] text-[#111] pt-40 pb-52 flex flex-col items-center text-center px-6 relative z-10">
        <motion.h2
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="text-4xl lg:text-[5.5rem] font-light leading-[1.05] mb-8 tracking-tight"
        >
          Esto no es solo software.
          <br />
          <span className="text-[#cc1100] font-medium">Es tu mejor vendedor.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-[18px] lg:text-[22px] font-medium text-[#555] max-w-3xl mb-16 leading-relaxed"
        >
          Deja de perder ventas por responder tarde. Nexova automatiza las conversaciones,
          gestiona objeciones y cobra en piloto automatico, para que tu te enfoques en crecer.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="flex gap-4"
        >
          <StoreButton icon={Apple} store="App Store" topText="Descargar en" />
        </motion.div>
      </section>

      <section ref={stickyRef} className="relative bg-[#111] text-white h-[300vh] z-20">
        <div className="sticky top-0 h-screen flex items-center overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(204,17,0,0.15)_0%,rgba(17,17,17,1)_100%)]" />

          <div className="max-w-[1400px] mx-auto px-6 lg:px-12 w-full grid lg:grid-cols-2 gap-20 items-center relative z-10">
            <div className="relative h-[400px]">
              <motion.div style={{ opacity: step1Opacity }} className="absolute inset-0 flex flex-col justify-center">
                <span className="text-[#cc1100] font-bold tracking-[0.2em] uppercase text-sm mb-6 flex items-center gap-2">
                  <div className="w-8 h-[1px] bg-[#cc1100]" /> Fase 01
                </span>
                <h3 className="text-5xl lg:text-7xl font-medium tracking-tight mb-6">
                  Sincronizacion Total.
                </h3>
                <p className="text-xl text-white/60 leading-relaxed max-w-md">
                  Conecta tu inventario en un clic. La IA lee y aprende todos tus productos,
                  precios y variables al instante.
                </p>
              </motion.div>

              <motion.div style={{ opacity: step2Opacity }} className="absolute inset-0 flex flex-col justify-center">
                <span className="text-[#cc1100] font-bold tracking-[0.2em] uppercase text-sm mb-6 flex items-center gap-2">
                  <div className="w-8 h-[1px] bg-[#cc1100]" /> Fase 02
                </span>
                <h3 className="text-5xl lg:text-7xl font-medium tracking-tight mb-6">
                  Atencion Empatica.
                </h3>
                <p className="text-xl text-white/60 leading-relaxed max-w-md">
                  El cliente escribe a tu WhatsApp. El agente de IA responde con naturalidad,
                  resuelve dudas y recomienda productos.
                </p>
              </motion.div>

              <motion.div style={{ opacity: step3Opacity }} className="absolute inset-0 flex flex-col justify-center">
                <span className="text-[#cc1100] font-bold tracking-[0.2em] uppercase text-sm mb-6 flex items-center gap-2">
                  <div className="w-8 h-[1px] bg-[#cc1100]" /> Fase 03
                </span>
                <h3 className="text-5xl lg:text-7xl font-medium tracking-tight mb-6">Cierre & Cobro.</h3>
                <p className="text-xl text-white/60 leading-relaxed max-w-md">
                  Genera enlaces de pago automaticamente. Una vez procesado, actualiza el stock y
                  te notifica. Magia pura.
                </p>
              </motion.div>
            </div>

            <div className="relative h-[600px] w-full bg-white/5 border border-white/10 rounded-[3rem] overflow-hidden flex justify-center backdrop-blur-sm">
              <motion.div
                style={{ y: mockupsY }}
                className="absolute top-0 w-full flex flex-col items-center gap-[200px] py-[100px]"
              >
                <div className="w-[80%] bg-[#222] border border-white/10 p-6 rounded-3xl shadow-2xl">
                  <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-4">
                    <div className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-gray-400" />{' '}
                      <span className="font-bold">Shopify Sync</span>
                    </div>
                    <span className="bg-green-500/20 text-green-400 text-xs font-bold px-3 py-1 rounded-full">
                      Activo
                    </span>
                  </div>
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex gap-4 items-center bg-black/40 p-3 rounded-xl">
                        <div className="w-12 h-12 bg-white/10 rounded-lg animate-pulse" />
                        <div className="flex-1">
                          <div className="h-3 bg-white/20 rounded w-full mb-2" />
                          <div className="h-3 bg-white/10 rounded w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="w-[80%] bg-[#F0F2F5] text-black p-6 rounded-3xl shadow-2xl flex flex-col gap-4 relative">
                  <div className="absolute -left-4 -top-4 w-12 h-12 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
                    <MessageCircle className="w-6 h-6 text-white" />
                  </div>
                  <div className="bg-white p-4 rounded-2xl rounded-tl-sm self-start max-w-[85%] shadow-sm">
                    ¿Tienen talla M de la chaqueta negra?
                  </div>
                  <div className="bg-[#E7FFDB] p-4 rounded-2xl rounded-tr-sm self-end max-w-[85%] shadow-sm relative">
                    ¡Hola! Sí, nos quedan 2 unidades en talla M. Cuesta $85. ¿Te separo una?
                    <span className="absolute bottom-1 right-2 text-[10px] text-gray-400">12:04 ✓✓</span>
                  </div>
                </div>

                <div className="w-[80%] bg-gradient-to-br from-green-400 to-green-600 text-white p-8 rounded-3xl shadow-[0_20px_50px_rgba(74,222,128,0.4)] flex flex-col items-center text-center">
                  <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-inner">
                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                  </div>
                  <h4 className="text-3xl font-bold mb-2">$85.00</h4>
                  <p className="text-green-100 mb-8 text-lg font-medium">Pago Exitoso - Orden #8942</p>
                  <div className="w-full h-2 bg-black/20 rounded-full overflow-hidden">
                    <div className="w-full h-full bg-white animate-[pulse_1.5s_ease-in-out_infinite]" />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      <section ref={cardsRef} className="relative min-h-[160vh] bg-[#cc1100] py-40 overflow-hidden z-20">
        <div className="absolute inset-0 pointer-events-none opacity-80">
          <div className="absolute w-[80vw] h-[80vw] top-[0%] left-[-20%] bg-[#ff5500] blur-[150px] mix-blend-screen rounded-full" />
          <div className="absolute w-[60vw] h-[60vw] bottom-[-10%] right-[-10%] bg-[#800000] blur-[150px] mix-blend-multiply rounded-full" />
        </div>

        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 grid lg:grid-cols-2 gap-10 relative z-10">
          <div className="relative h-[800px] hidden lg:block perspective-[1000px]">
            <motion.div
              style={{ y: card1Y }}
              className="absolute left-0 top-[10%] w-[280px] bg-[#1a1a1a] p-2 pb-6 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] border border-white/20 rotate-[-8deg] z-10"
            >
              <div className="relative w-full h-[320px] rounded-2xl overflow-hidden mb-4">
                <img
                  src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=600&q=80"
                  alt="Retail"
                  className="w-full h-full object-cover filter contrast-125"
                />
                <div className="absolute top-4 left-4 bg-[#cc1100] rounded-full p-1.5 shadow-lg">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
              </div>
              <p className="text-center font-medium text-white/90 text-xl px-2 leading-tight">
                Tiendas de
                <br />
                Ropa y Moda
              </p>
            </motion.div>

            <motion.div
              style={{ y: card2Y }}
              className="absolute left-[30%] top-[20%] w-[320px] bg-[#1a1a1a] p-2 pb-6 rounded-3xl shadow-[0_30px_70px_rgba(0,0,0,0.8)] border border-white/20 rotate-[4deg] z-30"
            >
              <div className="relative w-full h-[380px] rounded-2xl overflow-hidden mb-4">
                <img
                  src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&q=80"
                  alt="Emprendedoras"
                  className="w-full h-full object-cover filter contrast-125"
                />
                <div className="absolute top-4 left-4 bg-[#cc1100] rounded-full p-1.5 shadow-lg">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
              </div>
              <p className="text-center font-medium text-white/90 text-xl px-2 leading-tight">
                Agencias y
                <br />
                Servicios Digitales
              </p>
            </motion.div>

            <motion.div
              style={{ y: card3Y }}
              className="absolute left-[55%] top-[45%] w-[260px] bg-[#1a1a1a] p-2 pb-6 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] border border-white/20 rotate-[-3deg] z-20"
            >
              <div className="relative w-full h-[280px] rounded-2xl overflow-hidden mb-4">
                <img
                  src="https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=600&q=80"
                  alt="Profesional"
                  className="w-full h-full object-cover filter contrast-125"
                />
                <div className="absolute top-4 left-4 bg-[#cc1100] rounded-full p-1.5 shadow-lg">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
              </div>
              <p className="text-center font-medium text-white/90 text-xl px-2 leading-tight">
                Consultoras
                <br />
                y B2B
              </p>
            </motion.div>
          </div>

          <div className="flex flex-col justify-center h-full pt-20 lg:pt-0 lg:pl-10">
            <div className="inline-block border border-white/40 rounded-full px-6 py-2 text-[13px] font-bold mb-10 w-max tracking-widest uppercase">
              El sistema favorece a los grandes.
            </div>
            <h2 className="text-5xl lg:text-[6rem] font-medium tracking-tight mb-8 leading-[0.95]">
              Estamos <br /> cambiando eso.
            </h2>
            <p className="text-xl lg:text-[22px] text-white/90 font-light leading-relaxed max-w-lg">
              Diseñado para los comercios locales y fundadores que mantienen viva a la comunidad.
              Te damos la tecnologia de las multinacionales, para que compitas de igual a igual.
            </p>
          </div>
        </div>
      </section>

      <section
        ref={reasonalRef}
        className="relative bg-[#FFDFD1] text-[#1a1a1a] py-48 overflow-hidden z-30 rounded-t-[4rem] -mt-20 shadow-[0_-20px_50px_rgba(0,0,0,0.2)]"
      >
        <div className="max-w-5xl mx-auto text-center relative z-20 px-6">
          <p className="text-[12px] font-bold uppercase tracking-[0.3em] mb-12 text-[#cc1100]">
            La Filosofia Nexova
          </p>

          <h2 className="text-4xl md:text-[3.5rem] font-medium leading-[1.2] mb-12 tracking-tight">
            Como dueños de negocio, se espera que vendamos, gestionemos stock, respondamos rapido
            y <span className="italic font-serif text-[#cc1100]">nunca durmamos</span>.
          </h2>

          <p className="text-2xl md:text-[2.2rem] font-light leading-[1.4] mb-16 text-[#444]">
            Curiosamente, rara vez nos enseñan a automatizar esto sistematicamente.
          </p>

          <div className="w-10 h-10 mx-auto border-2 border-[#1a1a1a] grid grid-cols-2 gap-1 p-1.5 mb-16">
            <div className="bg-[#1a1a1a]" />
            <div className="bg-[#1a1a1a]" />
            <div className="bg-[#1a1a1a]" />
            <div className="bg-[#1a1a1a]" />
          </div>

          <p className="text-3xl md:text-[3rem] font-medium text-[#1a1a1a]">
            Con Nexova, recuperas tu tiempo.
          </p>
        </div>

        <motion.div
          style={{ y: rEl1 }}
          className="absolute left-[2%] top-[30%] w-36 h-36 lg:w-48 lg:h-48 bg-[#f8f8f8] rounded-[2rem] border-8 border-white shadow-2xl overflow-hidden p-2 rotate-[-6deg]"
        >
          <img
            src="https://images.unsplash.com/photo-1590602847861-f357a9332bbc?q=80&w=400&auto=format&fit=crop"
            className="w-full h-full object-cover filter grayscale contrast-150 sepia-[0.2]"
            alt="Vintage"
          />
        </motion.div>

        <motion.div
          style={{ y: rEl2 }}
          className="absolute left-[10%] top-[70%] w-28 h-28 lg:w-36 lg:h-36 bg-[#f8f8f8] rounded-[1.5rem] border-8 border-white shadow-2xl overflow-hidden p-2 rotate-[12deg]"
        >
          <img
            src="https://images.unsplash.com/photo-1587145820266-a5951ee6f620?q=80&w=400&auto=format&fit=crop"
            className="w-full h-full object-cover filter grayscale contrast-150 sepia-[0.2]"
            alt="Vintage"
          />
        </motion.div>

        <motion.div
          style={{ y: rEl3 }}
          className="absolute right-[-2%] top-[10%] w-56 h-56 lg:w-72 lg:h-72 bg-[#f8f8f8] rounded-bl-[4rem] border-l-8 border-b-8 border-white shadow-2xl overflow-hidden p-4"
        >
          <img
            src="https://images.unsplash.com/photo-1504221507732-5246c045949b?q=80&w=400&auto=format&fit=crop"
            className="w-full h-full object-cover filter grayscale contrast-150 sepia-[0.2]"
            alt="Vintage"
          />
        </motion.div>

        <motion.div
          style={{ y: rEl4 }}
          className="absolute right-[5%] top-[60%] w-40 h-40 lg:w-48 lg:h-48 bg-[#f8f8f8] rounded-tl-[3rem] border-8 border-white shadow-2xl overflow-hidden p-2 rotate-[-15deg]"
        >
          <img
            src="https://images.unsplash.com/photo-1511379938547-c1f69419868d?q=80&w=400&auto=format&fit=crop"
            className="w-full h-full object-cover filter grayscale contrast-150 sepia-[0.2]"
            alt="Vintage"
          />
        </motion.div>

        <motion.div
          style={{ y: rEl5 }}
          className="absolute right-[25%] bottom-[5%] w-32 h-32 lg:w-40 lg:h-40 bg-[#f8f8f8] rounded-[2rem] border-8 border-white shadow-2xl overflow-hidden p-2 rotate-[8deg]"
        >
          <img
            src="https://images.unsplash.com/photo-1506461803738-94dbf06b6f00?q=80&w=400&auto=format&fit=crop"
            className="w-full h-full object-cover filter grayscale contrast-200 sepia-[0.3]"
            alt="Vintage"
          />
        </motion.div>
      </section>

      <section className="bg-[#0a0a0f] text-white py-40 px-6 lg:px-12 relative z-40 rounded-t-[4rem] -mt-10">
        <div className="max-w-[1400px] mx-auto">
          <div className="text-center mb-24">
            <h2 className="text-5xl lg:text-[5rem] font-medium tracking-tight mb-6">
              Poder absoluto, <br />
              <span className="text-[#cc1100]">diseño simple.</span>
            </h2>
            <p className="text-xl text-white/50 max-w-2xl mx-auto">
              Todo lo que necesitas para operar un imperio digital desde tu navegador.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 auto-rows-[350px]">
            <div className="lg:col-span-2 bg-gradient-to-br from-[#1a1a24] to-[#0a0a0f] border border-white/10 rounded-[2.5rem] p-10 overflow-hidden relative group hover:border-white/20 transition-colors">
              <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#cc1100]/10 blur-[100px] rounded-full group-hover:bg-[#cc1100]/20 transition-colors" />
              <Shield className="w-10 h-10 text-[#cc1100] mb-6" />
              <h3 className="text-3xl font-bold mb-3">CRM Integrado</h3>
              <p className="text-white/60 text-lg max-w-md">
                Cada cliente, cada chat y cada compra guardada automaticamente. Sin Excel, sin
                estres.
              </p>
              <div className="absolute bottom-[-20%] right-[-10%] w-[80%] h-[70%] bg-[#111] border border-white/10 rounded-tl-3xl shadow-2xl p-6 rotate-[-5deg] group-hover:rotate-[-2deg] transition-transform duration-500">
                <div className="h-4 w-1/3 bg-white/10 rounded mb-4" />
                <div className="flex gap-4">
                  <div className="w-10 h-10 bg-white/5 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-full bg-white/5 rounded" />
                    <div className="h-3 w-1/2 bg-white/5 rounded" />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-bl from-[#2A0808] to-[#0a0a0f] border border-red-900/30 rounded-[2.5rem] p-10 relative group hover:border-red-500/50 transition-colors flex flex-col">
              <Zap className="w-10 h-10 text-[#ff4d00] mb-6" />
              <h3 className="text-3xl font-bold mb-3">Modelos IA</h3>
              <p className="text-white/60 text-lg flex-1">
                Usamos los modelos linguisticos mas avanzados para que el bot suene 100% humano.
              </p>
              <div className="mt-auto flex gap-2">
                <span className="bg-[#cc1100]/20 text-[#ff4d00] px-3 py-1 rounded-full text-xs font-bold border border-[#cc1100]/30">
                  GPT-4 Turbo
                </span>
                <span className="bg-[#cc1100]/20 text-[#ff4d00] px-3 py-1 rounded-full text-xs font-bold border border-[#cc1100]/30">
                  Claude 3.5
                </span>
              </div>
            </div>

            <div className="bg-[#111] border border-white/10 rounded-[2.5rem] p-10 group flex flex-col justify-center items-center text-center hover:bg-[#151515] transition-colors">
              <Smartphone className="w-16 h-16 text-white/20 mb-6 group-hover:text-white transition-colors duration-500" />
              <h3 className="text-2xl font-bold mb-2">Web & Movil</h3>
              <p className="text-white/50">
                Gestiona todo desde el PC en tu tienda, o desde la App en tu bolsillo.
              </p>
            </div>

            <div className="lg:col-span-2 bg-[#111] border border-white/10 rounded-[2.5rem] p-10 overflow-hidden relative group">
              <BarChart3 className="w-10 h-10 text-white mb-6" />
              <h3 className="text-3xl font-bold mb-3">Analitica Profunda</h3>
              <p className="text-white/60 text-lg">
                Descubre que productos traen mas consultas y cuales generan mas dinero real.
              </p>
              <div className="absolute bottom-0 right-10 flex items-end gap-3 h-32 opacity-30 group-hover:opacity-100 transition-opacity duration-500">
                <motion.div
                  initial={{ height: '20%' }}
                  whileInView={{ height: '60%' }}
                  className="w-10 bg-white rounded-t-lg"
                />
                <motion.div
                  initial={{ height: '20%' }}
                  whileInView={{ height: '40%' }}
                  className="w-10 bg-white rounded-t-lg"
                />
                <motion.div
                  initial={{ height: '20%' }}
                  whileInView={{ height: '80%' }}
                  className="w-10 bg-[#cc1100] rounded-t-lg"
                />
                <motion.div
                  initial={{ height: '20%' }}
                  whileInView={{ height: '100%' }}
                  className="w-10 bg-[#ff4d00] rounded-t-lg"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-black text-white pt-40 pb-12 px-6 lg:px-12 relative overflow-hidden z-50">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[100vw] h-[1px] bg-gradient-to-r from-transparent via-[#cc1100] to-transparent opacity-50" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[50vw] h-[300px] bg-[#cc1100] blur-[150px] opacity-20 pointer-events-none" />

        <div className="max-w-[1400px] mx-auto text-center mb-32 relative z-10">
          <motion.h2
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1 }}
            className="text-[4.5rem] md:text-[8rem] lg:text-[12rem] font-bold tracking-tighter leading-[0.85] mb-8"
          >
            Usa <span className="text-[#cc1100]">Nexova.</span>
          </motion.h2>
          <p className="text-2xl lg:text-3xl text-white/50 font-light max-w-2xl mx-auto">
            El comercio conversacional es ahora. <br />Empieza a vender en automatico hoy mismo.
          </p>

          <div className="mt-16 flex justify-center">
            <button
              className="bg-white text-black hover:bg-[#cc1100] hover:text-white text-xl font-bold px-12 py-6 rounded-full transition-all duration-300 shadow-[0_0_40px_rgba(255,255,255,0.2)] hover:shadow-[0_0_60px_rgba(204,17,0,0.6)] hover:scale-105"
              type="button"
            >
              Crear cuenta gratis
            </button>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-12 border-t border-white/10 pt-16 relative z-10">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 font-bold text-2xl mb-6 tracking-tight">
              <div className="w-6 h-6 bg-[#cc1100] rounded flex items-center justify-center">
                <span className="text-white text-xs">N</span>
              </div>
              Nexova
            </div>
            <p className="text-white/40 text-sm leading-relaxed max-w-xs">
              Software construido con pasion para negocios que importan.
            </p>
          </div>

          <div>
            <h4 className="font-bold mb-6 text-lg tracking-wide">Plataforma</h4>
            <ul className="space-y-4 text-sm font-medium text-white/50">
              <li>
                <a href="#" className="hover:text-white transition-colors">
                  Agente IA
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">
                  Dashboard CRM
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">
                  Integraciones
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-6 text-lg tracking-wide">Compañia</h4>
            <ul className="space-y-4 text-sm font-medium text-white/50">
              <li>
                <a href="#" className="hover:text-white transition-colors">
                  Nuestra Mision
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">
                  Contacto
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">
                  Blog
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-6 text-lg tracking-wide">Legal</h4>
            <ul className="space-y-4 text-sm font-medium text-white/50">
              <li>
                <a href="#" className="hover:text-white transition-colors">
                  Privacidad
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">
                  Terminos
                </a>
              </li>
            </ul>
          </div>
        </div>
      </footer>

      <div className="fixed bottom-6 right-6 lg:bottom-8 lg:right-8 z-[100]">
        <div className="bg-[#3b0b08] border-b-4 border-[#250503] shadow-[0_10px_30px_rgba(0,0,0,0.5)] rounded-[20px] p-4 pr-6 flex items-center gap-5 max-w-[420px]">
          <div className="text-4xl bg-[#cc1100]/10 p-2 rounded-full">🍪</div>
          <p className="text-[13px] font-medium leading-tight text-white/90 tracking-wide">
            Utilizamos cookies para
            <br />
            mejorar tu experiencia
          </p>
          <button
            className="bg-[#cc1100] hover:bg-red-600 text-white font-bold py-2.5 px-6 rounded-xl text-[13px] ml-auto transition-colors shadow-md"
            type="button"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
