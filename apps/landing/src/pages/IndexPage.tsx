import {
  ChevronDown,
  CheckCircle2,
  Instagram,
  Facebook,
  Linkedin,
  Mail,
} from 'lucide-react';
import {
  motion,
  useScroll,
  useTransform,
  AnimatePresence,
  type MotionValue,
} from 'motion/react';
import { useRef, useState } from 'react';

import FluidOrangeBackground from '../components/FluidOrangeBackground';

const AppleIcon = (): JSX.Element => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17.05 20.28c-.98.95-2.05 1.72-3.41 1.72-1.33 0-1.74-.83-3.32-.83-1.58 0-2.04.81-3.32.81-1.31 0-2.45-.79-3.44-1.76-2-1.95-3.05-5.54-3.05-8.23 0-4.38 2.76-6.69 5.39-6.69 1.4 0 2.53.88 3.33.88.75 0 2.05-.93 3.56-.93 1.05 0 3.75.39 5.2 2.51-3.66 1.73-3.07 6.42.52 8.24-.71 1.79-1.93 3.54-3.48 4.98zm-4.14-16.15c.66-1.02 1.1-2.44.89-3.87-1.21.05-2.67.81-3.54 1.83-.78.91-1.46 2.37-1.23 3.74 1.34.1 2.7-.68 3.88-1.7z" />
  </svg>
);

const PlayIcon = (): JSX.Element => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M3 20.5V3.5C3 2.9 3.4 2.4 4 2.2C4.2 2.1 4.3 2.1 4.5 2.1C4.9 2.1 5.3 2.3 5.6 2.6L18.6 11.1C19.2 11.5 19.5 12.2 19.3 12.9C19.2 13.2 19 13.5 18.6 13.7L5.6 22.2C5.1 22.5 4.5 22.5 4 22.2C3.4 22 3 21.5 3 20.9V20.5Z" />
  </svg>
);

const TikTokIcon = (): JSX.Element => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

const XIcon = (): JSX.Element => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  </svg>
);

type CharRevealProps = {
  char: string;
  progress: MotionValue<number>;
  start: number;
  end: number;
};

function CharReveal({ char, progress, start, end }: CharRevealProps): JSX.Element {
  const opacity = useTransform(progress, [start, end], [0, 1]);
  const y = useTransform(progress, [start, end], [15, 0]);

  return (
    <motion.span style={{ opacity, y, display: 'inline-block' }}>
      {char}
    </motion.span>
  );
}

type SectionCard = {
  id: number;
  title: string;
  img: string;
  rot: number;
  xPos: number;
  yPos: number;
};

const SECTION_CARDS: SectionCard[] = [
  {
    id: 1,
    title: 'Marcas outdoor de veteranos',
    img: 'https://images.unsplash.com/photo-1533561028507-b0de927b62dc?q=80&w=600&auto=format&fit=crop',
    rot: -15,
    xPos: -450,
    yPos: -40,
  },
  {
    id: 2,
    title: 'Agencias lideradas por latinas',
    img: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=600&auto=format&fit=crop',
    rot: 8,
    xPos: -200,
    yPos: 60,
  },
  {
    id: 3,
    title: 'Librerias con proposito',
    img: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?q=80&w=600&auto=format&fit=crop',
    rot: -5,
    xPos: 50,
    yPos: -80,
  },
  {
    id: 4,
    title: 'Cafeterias de la comunidad LGBTQ+',
    img: 'https://images.unsplash.com/photo-1501339817302-444d1ad26b04?q=80&w=600&auto=format&fit=crop',
    rot: 18,
    xPos: 280,
    yPos: 90,
  },
  {
    id: 5,
    title: 'Hogar y marcas sostenibles',
    img: 'https://images.unsplash.com/photo-1581578731522-745d051422f1?q=80&w=600&auto=format&fit=crop',
    rot: -10,
    xPos: 520,
    yPos: -20,
  },
];

type PricingPlan = {
  name: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  button: string;
  popular: boolean;
};

const PRICING_PLANS: PricingPlan[] = [
  {
    name: 'Explorer',
    price: 'Free',
    period: '',
    desc: 'Para individuos buscando hacer una diferencia en su dia a dia.',
    features: [
      'Acceso a todos los negocios locales',
      'Guarda tus favoritos',
      'Seguimiento basico de impacto',
    ],
    button: 'Comenzar',
    popular: false,
  },
  {
    name: 'Advocate',
    price: '$5',
    period: '/mo',
    desc: 'Para quienes quieren amplificar su impacto y apoyar el movimiento.',
    features: [
      'Todo en Explorer',
      'Metricas avanzadas de impacto',
      'Beneficios exclusivos',
      'Soporte prioritario',
    ],
    button: 'Ser Advocate',
    popular: true,
  },
  {
    name: 'Partner',
    price: '$15',
    period: '/mo',
    desc: 'Para negocios locales que desean destacar en la plataforma.',
    features: [
      'Perfil de negocio destacado',
      'Dashboard de analiticas',
      'Herramientas de marketing',
      'Manager de cuenta dedicado',
    ],
    button: 'Unirse como Partner',
    popular: false,
  },
];

type FaqItem = {
  title: string;
  content: string;
};

const FAQ_DATA: FaqItem[] = [
  {
    title: 'Stop scrolling. Start supporting.',
    content:
      'Find businesses that align with your values... instantly. No noise. No second-guessing. Just one simple tap.',
  },
  {
    title: 'See your impact.',
    content:
      'Track how your everyday spending helps fuel communities, local economies, and causes you truly care about.',
  },
  {
    title: 'Get rewarded for doing good.',
    content:
      'Earn perks and exclusive benefits from your favorite local businesses just by shopping with intention.',
  },
  {
    title: 'Discover what deserves to be found.',
    content:
      'We highlight underrepresented founders and gems in your city that are making a real difference.',
  },
  {
    title: 'Be part of the shift.',
    content:
      'Join a growing community of people who are voting for a better world with their wallets.',
  },
];

export default function IndexPage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const phase7Ref = useRef<HTMLDivElement>(null);
  const phase8Ref = useRef<HTMLDivElement>(null);
  const phase11Ref = useRef<HTMLDivElement>(null);
  const phase12Ref = useRef<HTMLDivElement>(null);

  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });
  // Use scrollYProgress directly — no spring, animations are 100% linear (scroll speed = animation speed)
  const smoothProgress = scrollYProgress;

  // Card expande sobre 176vh (2×) en vez de 88vh — más gradual, no "snap"
  const heroWidth = useTransform(scrollYProgress, [0, 0.08], ['94%', '100%']);
  const heroHeight = useTransform(scrollYProgress, [0, 0.08], ['92%', '100%']);
  const heroRadius = useTransform(scrollYProgress, [0, 0.08], ['3.5rem', '0rem']);

  // Phones: se mueven gradualmente (±1200px) pero se DESVANECEN antes de que sec2
  // aparezca en 0.10. phone1 tiene z-40 (> sec2 z-30), si no se desvanece se ve
  // colgado encima de la siguiente sección. El Y sigue hasta 0.18 pero invisible.
  const phone1Y = useTransform(scrollYProgress, [0.02, 0.18], [0, -1200]);
  const phone1Rotate = useTransform(scrollYProgress, [0.02, 0.18], [-15, -35]);
  const phone1Opacity = useTransform(scrollYProgress, [0.02, 0.09], [1, 0]);
  const phone2Y = useTransform(scrollYProgress, [0.02, 0.18], [0, 1200]);
  const phone2Rotate = useTransform(scrollYProgress, [0.02, 0.18], [-15, 10]);
  const phone2Opacity = useTransform(scrollYProgress, [0.02, 0.09], [1, 0]);

  // Texto hero: fade gradual pero terminado antes de sec2 (nav: 0.09, text: 0.12)
  const textHeroX = useTransform(scrollYProgress, [0.03, 0.16], [0, -700]);
  const textHeroOpacity = useTransform(scrollYProgress, [0.03, 0.12], [1, 0]);
  // Nav debe desaparecer antes de 0.10 (sec2 entry) — igual que original
  const navOpacity = useTransform(scrollYProgress, [0.02, 0.09], [1, 0]);

  const sec2Y = useTransform(scrollYProgress, [0.1, 0.14], ['40vh', '0vh']);
  const sec2Opacity = useTransform(scrollYProgress, [0.1, 0.12, 0.2, 0.24], [0, 1, 1, 0]);

  const text1Lines = ['This isn\'t about who', 'shouts the loudest.'];
  const text2Lines = ['Wherever your money', 'goes, change follows.'];
  const text1Opacity = useTransform(scrollYProgress, [0.63, 0.66], [1, 0]);
  const text2Opacity = useTransform(scrollYProgress, [0.79, 0.83], [1, 0]);

  // Circle: nudged to 0.76 so text2 (fully revealed at 0.75) stays visible longer,
  // but still reaches scale 3 well before MacBook entry at 0.81.
  const circleScale = useTransform(scrollYProgress, [0.76, 0.86], [0, 3]);

  // MacBook: compressed window [0.85 → 0.955] = 168vh at 1600vh total
  // Circle fully open at 0.86, so MacBook enters into clean white.
  const deviceTravelY = useTransform(
    scrollYProgress,
    [0.85, 0.878, 0.925, 0.955],
    ['110vh', '0vh', '-30vh', '-140vh'],
  );
  const deviceScale = useTransform(scrollYProgress, [0.878, 0.925], [1, 0.95]);

  // Mac text timings: compressed to match new entry/exit window.
  const macText1Opacity = useTransform(scrollYProgress, [0.881, 0.900, 0.925, 0.955], [0, 1, 1, 0]);
  const macText1Y = useTransform(scrollYProgress, [0.881, 0.900], [22, 0]);
  const macText2Opacity = useTransform(scrollYProgress, [0.891, 0.910, 0.925, 0.955], [0, 1, 1, 0]);
  const macText2Y = useTransform(scrollYProgress, [0.891, 0.910], [18, 0]);

  const renderRevealText = (
    lines: string[],
    startRange: number,
    endRange: number,
    className: string,
    progressSource: MotionValue<number>,
  ): JSX.Element => {
    const totalChars = lines.join('').length;
    const step = (endRange - startRange) / Math.max(totalChars, 1);
    let globalIndex = 0;

    return (
      <div className={className}>
        {lines.map((line, lineIdx) => (
          <div key={lineIdx} className="flex justify-center flex-wrap">
            {line.split(' ').map((word, wordIdx) => (
              <span key={`${lineIdx}-${wordIdx}`} className="inline-block whitespace-nowrap mr-[0.25em]">
                {word.split('').map((char, charIdx) => {
                  const charStart = startRange + step * globalIndex;
                  const charEnd = charStart + step * 8;
                  globalIndex += 1;
                  return (
                    <CharReveal
                      key={`${lineIdx}-${wordIdx}-${charIdx}`}
                      char={char}
                      progress={progressSource}
                      start={charStart}
                      end={charEnd}
                    />
                  );
                })}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  };

  // Phase7: card zooms in linearly — direct scroll progress, no spring
  const { scrollYProgress: p7Progress } = useScroll({
    target: phase7Ref,
    offset: ['start end', 'end end'],
  });
  const p7Width = useTransform(p7Progress, [0, 0.2], ['88%', '100%']);
  const p7Height = useTransform(p7Progress, [0, 0.2], ['82%', '100%']);
  const p7Radius = useTransform(p7Progress, [0, 0.2], ['4rem', '0rem']);

  const { scrollYProgress: p8Progress } = useScroll({
    target: phase8Ref,
    offset: ['start 60%', 'end end'],
  });
  // Direct progress — linear, no spring
  const p8BgColor = useTransform(p8Progress, [0.35, 0.65], ['#ffffff', '#000000']);
  const p8MainColor = useTransform(p8Progress, [0.35, 0.65], ['#3e2723', '#ffffff']);
  const p8SubColor = useTransform(p8Progress, [0.35, 0.65], ['#52525b', '#d4d4d8']);

  const p8Text1 = [
    'Pocketchange will always be',
    'free to explore. No paywalls, no',
    'ads, no pressure. Discovering',
    'businesses that reflect your',
    "values shouldn't cost a thing.",
  ];

  const p8Text2 = [
    "We're building this with care and intention. Every dollar from our business members helps fuel the movement, but everything we create is in service of what matters most: you, your values, and your power to create real change (and a better world). While the businesses you see pay a small monthly fee to be featured, your access will always stay free. This model keeps us accountable to the community, not to advertisers.",
  ];

  const { scrollYProgress: p11Progress } = useScroll({
    target: phase11Ref,
    offset: ['start end', 'end end'],
  });
  // Direct progress — linear, no spring
  const p11Width = useTransform(p11Progress, [0, 0.35], ['90%', '100%']);
  const p11Height = useTransform(p11Progress, [0, 0.35], ['85%', '100%']);
  const p11Radius = useTransform(p11Progress, [0, 0.35], ['4rem', '0rem']);

  const { scrollYProgress: p12Progress } = useScroll({
    target: phase12Ref,
    offset: ['start end', 'end end'],
  });
  const p12TextLines = ["Let's Pocketchange", 'the world'];

  return (
    <div className="bg-white">
      <div ref={containerRef} className="relative w-full bg-black" style={{ height: '1600vh' }}>
        <div className="sticky top-0 h-screen w-full flex items-center justify-center overflow-hidden z-20">
          <motion.div
            style={{ width: heroWidth, height: heroHeight, borderRadius: heroRadius }}
            className="relative overflow-hidden flex flex-col bg-[#ff4200] z-10 shadow-2xl"
          >
            <div className="absolute inset-0 pointer-events-none z-0">
              <FluidOrangeBackground className="absolute inset-0" seed={0.15} />
              <div className="absolute inset-0 opacity-[0.2] mix-blend-overlay z-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
            </div>

            <motion.nav
              style={{ opacity: navOpacity }}
              className="relative z-50 flex items-center justify-between px-12 py-10 text-white font-black italic uppercase tracking-tighter"
            >
              <div className="text-3xl">POCKETCHANGE</div>
              <div className="hidden lg:flex items-center gap-10 text-[11px] tracking-[0.3em] opacity-60 font-bold">
                <span>Who it's for</span>
                <span>How it works</span>
                <span>Business</span>
                <span>Sponsor</span>
              </div>
              <button
                type="button"
                className="px-10 py-4 bg-black rounded-full text-[11px] tracking-widest font-bold hover:bg-white hover:text-black transition-colors"
              >
                CONTACTO
              </button>
            </motion.nav>

            <div className="relative flex-1 flex items-center px-12 md:px-32 z-10 pointer-events-none">
              <motion.div
                style={{ opacity: textHeroOpacity, x: textHeroX }}
                className="max-w-5xl text-white pointer-events-auto"
              >
                <h1 className="text-6xl md:text-[96px] font-black leading-[1.05] tracking-tighter mb-8 drop-shadow-2xl italic">
                  Vendé más. <br />Atendé mejor. <br />Crecé sin límites.
                </h1>
                <p className="text-base md:text-xl opacity-80 mb-12 max-w-sm font-medium leading-relaxed tracking-tight">
                  Joyas locales. Fundadores subrepresentados. Marcas haciendo el bien. Gasta con
                  proposito.
                </p>
                <div className="flex flex-wrap gap-8">
                  <div className="flex items-center gap-6 px-12 py-7 bg-black rounded-[2.5rem] shadow-2xl group cursor-pointer active:scale-95 transition-transform">
                    <AppleIcon />
                    <div className="text-left font-black">
                      <p className="text-[10px] uppercase opacity-40">Download on</p>
                      <p className="text-2xl">App Store</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 px-12 py-7 bg-black rounded-[2.5rem] shadow-2xl group cursor-pointer active:scale-95 transition-transform">
                    <PlayIcon />
                    <div className="text-left font-black">
                      <p className="text-[10px] uppercase opacity-40">Get it on</p>
                      <p className="text-2xl">Google Play</p>
                    </div>
                  </div>
                </div>
              </motion.div>
              {/* Right panel: phone1 arriba-izquierda, phone2 abajo-derecha, más juntos */}
              <div className="absolute right-0 top-0 bottom-0 w-1/2">
                {/* Phone 1 — arriba, centrado hacia la izquierda del panel */}
                <motion.div
                  style={{ y: phone1Y, rotate: phone1Rotate, opacity: phone1Opacity }}
                  className="absolute z-40 top-6 left-[10%]"
                >
                  <img
                    src="/assets/phone1.webp"
                    alt="Phone Front"
                    className="max-h-[65vh] w-auto drop-shadow-2xl"
                  />
                </motion.div>

                {/* Phone 2 — abajo, centrado hacia la derecha del panel */}
                <motion.div
                  style={{ y: phone2Y, rotate: phone2Rotate, opacity: phone2Opacity }}
                  className="absolute z-20 bottom-6 right-[10%] blur-[0.5px]"
                >
                  <img
                    src="/assets/phone2.webp"
                    alt="Phone Back"
                    className="max-h-[60vh] w-auto drop-shadow-xl"
                  />
                </motion.div>
              </div>
            </div>

            <motion.div
              style={{ y: sec2Y, opacity: sec2Opacity }}
              className="absolute inset-0 z-30 flex items-center justify-center px-6 pointer-events-none"
            >
              <div className="max-w-6xl w-full text-center text-white flex flex-col items-center">
                <div className="mb-12 px-8 py-3 rounded-full border border-white/30 backdrop-blur-sm inline-block shadow-lg uppercase tracking-widest text-[10px] font-black">
                  El sistema favorece a los ruidosos, no a los dignos.
                </div>
                <h2 className="text-5xl md:text-9xl font-medium leading-[1] tracking-tight mb-16 drop-shadow-xl italic">
                  Estamos cambiando eso. <br />Una compra alineada a la vez.
                </h2>
                <p className="text-lg md:text-2xl opacity-80 max-w-3xl leading-relaxed font-medium">
                  Pocketchange honra a los negocios que reescriben las reglas, arraigados
                  localmente y amados por su comunidad.
                </p>
              </div>
            </motion.div>

            <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
              {SECTION_CARDS.map((card, idx) => {
                const startEntry = 0.22 + idx * 0.03;
                // Rango extendido: 0.10 en vez de 0.06 (220vh vs 132vh).
                // Sin spring, el recorrido desde y=1400 debe ser más largo para que
                // se vea el "subir desde abajo" en vez de aparecer de golpe.
                const endEntry = startEntry + 0.10;
                const startExit = 0.44 + idx * 0.02;
                const endExit = startExit + 0.08;

                const y = useTransform(
                  smoothProgress,
                  [startEntry, endEntry, startExit, endExit],
                  [700, card.yPos, card.yPos - 40, -1200],
                );
                // Fade-in extendido: 0.05 en vez de 0.02 (110vh vs 44vh)
                const opacity = useTransform(
                  smoothProgress,
                  [startEntry, startEntry + 0.05, startExit, endExit],
                  [0, 1, 1, 0],
                );
                const rotation = useTransform(
                  smoothProgress,
                  [startEntry, endEntry, startExit, endExit],
                  [card.rot * 1.8, card.rot, card.rot, card.rot * 0.5],
                );
                const scale = useTransform(
                  smoothProgress,
                  [startEntry, endEntry, startExit, endExit],
                  [0.8, 1, 1, 0.85],
                );

                return (
                  <motion.div
                    key={card.id}
                    style={{ y, opacity, scale, rotate: rotation, x: card.xPos }}
                    className="absolute w-[260px] md:w-[360px] aspect-[4/5.2] bg-zinc-950 rounded-[2.5rem] overflow-hidden shadow-[0_50px_100px_rgba(0,0,0,0.7)] border border-white/10"
                  >
                    <img src={card.img} alt={card.title} className="w-full h-full object-cover opacity-70" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent p-8 flex flex-col justify-between">
                      <div className="flex justify-start">
                        <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center text-white shadow-xl">
                          <CheckCircle2 size={20} fill="white" />
                        </div>
                      </div>
                      <p className="text-white font-black text-2xl leading-[1.1] tracking-tight mb-2 uppercase italic">
                        {card.title}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <div className="absolute inset-0 z-[45] flex items-center justify-center pointer-events-none px-6">
              <motion.div style={{ opacity: text1Opacity }} className="absolute text-center w-full max-w-6xl">
                {renderRevealText(
                  text1Lines,
                  0.52,
                  0.6,
                  'text-white text-5xl md:text-[100px] font-light leading-[1.1] tracking-tight drop-shadow-2xl',
                  smoothProgress,
                )}
              </motion.div>
              <motion.div style={{ opacity: text2Opacity }} className="absolute text-center w-full max-w-6xl">
                {renderRevealText(
                  text2Lines,
                  0.67,
                  0.75,
                  'text-white text-5xl md:text-[100px] font-light leading-[1.1] tracking-tight drop-shadow-2xl',
                  smoothProgress,
                )}
              </motion.div>
            </div>

            <motion.div
              style={{ scale: circleScale, x: '-50%', y: '50%' }}
              className="absolute bottom-0 left-1/2 w-[150vw] aspect-square bg-white rounded-full z-[48] pointer-events-none"
            />
            {/* MacBook + text — absolutely positioned so they never take up flex flow space */}
            <div className="absolute inset-0 z-[49] pointer-events-none">
              {/* MacBook mockup — centred at top, travels up via deviceTravelY */}
              <motion.div
                style={{ y: deviceTravelY, scale: deviceScale, x: '-50%', left: '50%' }}
                className="absolute top-8 md:top-10 w-[340px] md:w-[700px] lg:w-[900px] flex flex-col items-center drop-shadow-[0_-20px_50px_rgba(0,0,0,0.2)]"
              >
                <div className="w-full aspect-[16/10] bg-zinc-900 rounded-t-2xl md:rounded-t-[2.5rem] border-[8px] md:border-[16px] border-zinc-900 overflow-hidden relative">
                  <img
                    src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200&auto=format&fit=crop"
                    alt="Screen App"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 md:w-3 h-2 md:h-3 bg-black rounded-full mt-2 md:mt-3 shadow-inner" />
                </div>
                <div className="w-[115%] h-3 md:h-6 bg-zinc-300 rounded-b-xl md:rounded-b-2xl flex justify-center relative z-10 border-t border-white/50 shadow-[0_20px_40px_rgba(0,0,0,0.15)]">
                  <div className="w-1/4 h-1.5 md:h-2 bg-zinc-400 rounded-b-md shadow-inner" />
                </div>

                {/* Text pinned BELOW the MacBook inside the same travelling div — no extra layout space */}
                <div className="w-full max-w-5xl text-center px-6 mt-8 md:mt-12">
                  <motion.p
                    style={{ opacity: macText1Opacity, y: macText1Y }}
                    className="text-4xl md:text-[70px] font-light leading-[1.1] tracking-tight text-[#ff4200] mb-4 md:mb-8"
                  >
                    This isn't just an application.<br />It's a call for action.
                  </motion.p>
                  <motion.p
                    style={{ opacity: macText2Opacity, y: macText2Y }}
                    className="text-base md:text-2xl font-medium leading-relaxed tracking-tight text-zinc-800 max-w-4xl mx-auto"
                  >
                    Turn your spending into a tool for change, not just convenience. Put visibility where it belongs: with the people who hold our communities together.
                  </motion.p>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      <div ref={phase7Ref} className="relative w-full z-30 -mt-[120vh]" style={{ height: '100vh' }}>
        {/* bg-black fills the frame around the rounded card — no white bleeding */}
        <div className="sticky top-0 h-screen w-full flex items-center justify-center overflow-hidden bg-black">
          <motion.div
            style={{ width: p7Width, height: p7Height, borderRadius: p7Radius }}
            className="relative bg-[#ff4200] overflow-hidden flex flex-col"
          >
            {/* Background image — static, no parallax */}
            <div className="absolute inset-0 w-full h-full z-0">
              <img
                src="https://images.unsplash.com/photo-1506869640319-a1a5606089ce?q=80&w=1600&auto=format&fit=crop"
                alt="Silhouette"
                className="w-full h-full object-cover mix-blend-multiply opacity-80"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#ff4200] via-[#ff4200]/80 to-transparent" />
            </div>

            {/* Content — simple fade-in, no vertical scroll movement */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: false, amount: 0.3 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="relative z-10 h-full flex flex-col justify-center px-10 md:px-24 max-w-3xl text-white"
            >
              <div className="mb-8 inline-block self-start border border-white/40 rounded-full px-6 py-2 text-[10px] md:text-xs font-black tracking-widest uppercase">
                We see you. This is your platform.
              </div>

              <h2 className="text-5xl md:text-[85px] font-light leading-[1.05] tracking-tight mb-8">
                Let's shift the <br /> economy, one <br /> dollar at a time.
              </h2>

              <p className="text-base md:text-xl opacity-90 max-w-lg mb-12 leading-relaxed font-medium">
                Backed by purpose, not popularity. For people who shop with heart, even when the
                time is short. For families, dreamers, and communities that get overlooked. For
                anyone who wants their money to mean something.
              </p>

              <div className="flex flex-wrap gap-6">
                <button
                  type="button"
                  className="flex items-center gap-5 px-8 py-5 bg-white text-black rounded-[2rem] shadow-xl hover:scale-105 active:scale-95 transition-transform group"
                >
                  <div className="text-black">
                    <AppleIcon />
                  </div>
                  <div className="text-left font-black">
                    <p className="text-[10px] uppercase opacity-60">Download in the</p>
                    <p className="text-xl leading-none">App Store</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-5 px-8 py-5 bg-white text-black rounded-[2rem] shadow-xl hover:scale-105 active:scale-95 transition-transform group"
                >
                  <div className="text-black">
                    <PlayIcon />
                  </div>
                  <div className="text-left font-black">
                    <p className="text-[10px] uppercase opacity-60">Download on</p>
                    <p className="text-xl leading-none">Google Play</p>
                  </div>
                </button>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      <div ref={phase8Ref} className="relative w-full z-20" style={{ height: '520vh' }}>
        <motion.div
          style={{ backgroundColor: p8BgColor }}
          className="sticky top-0 h-screen w-full flex flex-col items-center justify-center px-6 overflow-hidden transition-colors duration-700"
        >
          <div className="w-full max-w-5xl text-center flex flex-col items-center">
            <motion.div style={{ color: p8MainColor }}>
              {renderRevealText(
                p8Text1,
                0.05,
                0.4,
                'text-4xl md:text-[65px] font-light leading-[1.1] tracking-tight mb-12',
                p8Progress,
              )}
            </motion.div>

            <motion.div style={{ color: p8SubColor }}>
              {renderRevealText(
                p8Text2,
                0.35,
                0.75,
                'text-sm md:text-[18px] font-medium leading-relaxed tracking-tight max-w-4xl mx-auto',
                p8Progress,
              )}
            </motion.div>
          </div>
        </motion.div>
      </div>

      <div className="relative w-full bg-black py-20 lg:py-32 px-6 flex flex-col items-center justify-center z-10">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, margin: '-100px' }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="text-center mb-24"
        >
          <h2 className="text-4xl md:text-6xl font-light tracking-tight text-white mb-6">
            Simple, transparent <span className="italic text-[#ff4200]">pricing</span>.
          </h2>
          <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto">
            Choose the plan that best fits your journey to make an impact.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-6xl w-full">
          {PRICING_PLANS.map((plan, idx) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, margin: '-50px' }}
              transition={{ duration: 0.6, delay: idx * 0.15, ease: 'easeOut' }}
              className={`relative flex flex-col p-10 rounded-[2.5rem] border ${plan.popular ? 'border-[#ff4200]/50 bg-zinc-900' : 'border-white/10 bg-zinc-950'
                } overflow-hidden shadow-2xl hover:-translate-y-2 transition-transform duration-300`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-[#ff4200] text-white text-[10px] font-black uppercase tracking-widest py-1.5 px-6 rounded-b-xl shadow-lg">
                  Most Popular
                </div>
              )}
              <div className="mb-8 mt-4 border-b border-white/10 pb-8">
                <h3 className="text-2xl font-light text-white mb-4">{plan.name}</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-6xl font-light text-white tracking-tight">{plan.price}</span>
                  {plan.period && <span className="text-zinc-500 font-medium">{plan.period}</span>}
                </div>
                <p className="text-sm text-zinc-400 mt-6 h-10 leading-relaxed">{plan.desc}</p>
              </div>
              <div className="flex-1">
                <ul className="flex flex-col gap-5 mb-10">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-zinc-300 text-sm font-medium">
                      <CheckCircle2 size={18} className="text-[#ff4200] shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                className={`w-full py-5 rounded-full font-black text-[11px] tracking-widest uppercase transition-all active:scale-95 ${plan.popular
                  ? 'bg-[#ff4200] text-white shadow-[0_0_30px_rgba(255,66,0,0.3)] hover:shadow-[0_0_40px_rgba(255,66,0,0.5)]'
                  : 'bg-white text-black hover:bg-zinc-200'
                  }`}
              >
                {plan.button}
              </button>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="relative w-full bg-black pb-20 px-6 flex justify-center overflow-hidden z-10">
        <div className="max-w-6xl w-full bg-[#0a0a0a] border border-white/5 rounded-[3rem] p-10 lg:p-20 grid grid-cols-1 lg:grid-cols-2 gap-16 relative overflow-hidden">
          <div className="relative z-10 flex flex-col justify-center">
            <h2 className="text-4xl md:text-5xl font-light tracking-tight text-white mb-12">
              What happens <br /> after I download?
            </h2>

            <div className="flex flex-col">
              {FAQ_DATA.map((faq, idx) => {
                const isOpen = openFaq === idx;

                return (
                  <div
                    key={faq.title}
                    className="border-b border-white/10 py-6 cursor-pointer group"
                    onClick={(): void => setOpenFaq(isOpen ? null : idx)}
                    onKeyDown={(e): void => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpenFaq(isOpen ? null : idx);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-lg md:text-xl font-medium text-white group-hover:text-[#ff4200] transition-colors pr-8">
                        {faq.title}
                      </h4>
                      <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3 }}>
                        <ChevronDown className="text-zinc-500" />
                      </motion.div>
                    </div>

                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <p className="text-zinc-400 mt-4 leading-relaxed pr-8">{faq.content}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative flex items-center justify-center min-h-[400px] lg:min-h-full">
            <motion.div
              initial={{ x: 150, y: 150, rotate: 25, opacity: 0 }}
              whileInView={{ x: 0, y: 0, rotate: [-5, 8, -3, 0], opacity: 1 }}
              viewport={{ once: false, margin: '-50px' }}
              transition={{
                duration: 1.2,
                ease: 'easeOut',
                rotate: { duration: 1.5, ease: 'easeInOut', times: [0, 0.4, 0.7, 1] },
              }}
              className="absolute -right-10 lg:-right-20 -bottom-10 lg:-bottom-20 w-[320px] md:w-[400px] lg:w-[480px] pointer-events-none drop-shadow-[0_0_50px_rgba(0,0,0,1)] origin-bottom-right"
            >
              <img
                src="https://i.ibb.co/XFfX6xT/1771333296-compressor-png-image.png"
                alt="Phone Mockup"
                className="w-full h-auto"
              />
            </motion.div>
          </div>
        </div>
      </div>

      <div
        ref={phase11Ref}
        className="relative w-full h-screen flex items-center justify-center overflow-hidden bg-black pb-0 z-20"
      >
        <motion.div
          style={{ width: p11Width, height: p11Height, borderRadius: p11Radius }}
          className="relative bg-[#b91c1c] overflow-hidden flex flex-col justify-center shadow-[0_-20px_80px_rgba(0,0,0,0.8)]"
        >
          <div className="absolute inset-0 w-full h-full z-0">
            <img
              src="https://images.unsplash.com/photo-1581578731548-c64695cc6952?q=80&w=1600&auto=format&fit=crop"
              alt="Business Owner working"
              className="w-full h-full object-cover mix-blend-multiply opacity-70"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#990000] via-[#990000]/90 to-transparent" />
          </div>

          <div className="relative z-10 px-10 md:px-24 max-w-4xl text-white">
            <div className="mb-8 inline-block border border-white/40 rounded-full px-6 py-2 text-[10px] md:text-xs font-black tracking-widest uppercase">
              A word to the business owners
            </div>

            <h2 className="text-5xl md:text-[75px] lg:text-[85px] font-light leading-[1.05] tracking-tight mb-8">
              You're not just part <br /> of the economy. You <br /> are the economy.
            </h2>

            <p className="text-base md:text-xl opacity-90 max-w-2xl mb-10 leading-relaxed font-medium">
              You create jobs, drive growth, and hold communities together, but platforms overlook
              you and algorithms bury you. We make your business visible based on who you are and
              what you stand for, not how much you spend. No boosting. No bidding. Just real
              alignment, seen by real people who care about real business.
            </p>

            <p className="text-sm md:text-base font-bold mb-6">List your business free while spots last</p>

            <div className="flex flex-wrap gap-6">
              <button
                type="button"
                className="flex items-center gap-5 px-8 py-5 bg-white text-black rounded-[2rem] shadow-xl hover:scale-105 active:scale-95 transition-transform group"
              >
                <div className="text-black">
                  <AppleIcon />
                </div>
                <div className="text-left font-black">
                  <p className="text-[10px] uppercase opacity-60">Download in the</p>
                  <p className="text-xl leading-none">App Store</p>
                </div>
              </button>
              <button
                type="button"
                className="flex items-center gap-5 px-8 py-5 bg-white text-black rounded-[2rem] shadow-xl hover:scale-105 active:scale-95 transition-transform group"
              >
                <div className="text-black">
                  <PlayIcon />
                </div>
                <div className="text-left font-black">
                  <p className="text-[10px] uppercase opacity-60">Download on</p>
                  <p className="text-xl leading-none">Google Play</p>
                </div>
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      <div ref={phase12Ref} className="relative w-full bg-[#ff4200] overflow-hidden z-10">
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <FluidOrangeBackground className="absolute inset-0" seed={1.85} />
          <div className="absolute inset-0 opacity-[0.2] mix-blend-overlay z-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
        </div>

        <div className="relative z-10 w-full min-h-screen flex flex-col items-center justify-between pt-32 pb-12">
          <div className="w-full text-center px-6 mt-10 md:mt-20">
            {renderRevealText(
              p12TextLines,
              0.15,
              0.5,
              'text-5xl md:text-[100px] font-light leading-[1.1] tracking-tight text-white drop-shadow-2xl',
              p12Progress,
            )}
          </div>

          <div className="w-full px-6 md:px-12 flex flex-col items-center text-white mt-32 md:mt-40">
            <div className="flex items-center w-full max-w-6xl mb-24">
              <div className="flex-1 h-px bg-white/20" />
              <div className="flex items-center gap-5 md:gap-8 px-6 md:px-10">
                <a href="#" className="hover:text-white/60 transition-colors" aria-label="Instagram">
                  <Instagram strokeWidth={1.5} size={26} />
                </a>
                <a href="#" className="hover:text-white/60 transition-colors" aria-label="Facebook">
                  <Facebook strokeWidth={1.5} size={26} />
                </a>
                <a href="#" className="hover:text-white/60 transition-colors" aria-label="Linkedin">
                  <Linkedin strokeWidth={1.5} size={26} />
                </a>
                <a href="#" className="hover:text-white/60 transition-colors" aria-label="TikTok">
                  <TikTokIcon />
                </a>
                <a href="#" className="hover:text-white/60 transition-colors" aria-label="X">
                  <XIcon />
                </a>
                <a href="#" className="hover:text-white/60 transition-colors" aria-label="Mail">
                  <Mail strokeWidth={1.5} size={26} />
                </a>
              </div>
              <div className="flex-1 h-px bg-white/20" />
            </div>

            <h3 className="text-2xl md:text-3xl font-light text-center mb-8 max-w-2xl leading-snug tracking-tight">
              Ready for impact reports, business callouts, and cheeky love notes?
            </h3>

            <div className="flex flex-col sm:flex-row items-center w-full max-w-lg bg-[#550000] p-1.5 md:p-2 rounded-full mb-32 border border-white/5 shadow-2xl">
              <input
                type="email"
                placeholder="Email Address"
                className="flex-1 bg-transparent text-white placeholder-white/50 px-6 py-3 outline-none min-w-0 font-medium"
              />
              <button
                type="button"
                className="bg-white text-[#ff4200] font-black px-8 py-3 rounded-full hover:bg-zinc-100 transition-colors shrink-0"
              >
                Subscribe
              </button>
            </div>

            <div className="w-full max-w-6xl flex flex-col md:flex-row items-center justify-between gap-6 text-xs md:text-sm font-bold text-white tracking-wide">
              <p>All Rights Reserved © 2026 Pocketchange</p>
              <div className="flex gap-8">
                <a href="#" className="hover:opacity-70 transition-opacity">
                  Privacy
                </a>
                <a href="#" className="hover:opacity-70 transition-opacity">
                  Cookies
                </a>
                <a href="#" className="hover:opacity-70 transition-opacity">
                  Site by 12
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div >
  );
}
