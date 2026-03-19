import FluidDarkBackground from './FluidDarkBackground';

type CheckoutBackgroundProps = {
  seed?: number;
  success?: boolean;
};

export default function CheckoutBackground({ seed = 0.33, success = false }: CheckoutBackgroundProps): JSX.Element {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <FluidDarkBackground className="absolute inset-0" seed={seed} />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, hsl(228 67% 1.2%) 0%, hsl(228 67% 1.2% / 0.85) 15%, hsl(228 67% 1.2% / 0.4) 35%, transparent 55%), linear-gradient(to top, hsl(228 67% 1.2%) 0%, hsl(228 67% 1.2% / 0.85) 15%, hsl(228 67% 1.2% / 0.4) 35%, transparent 55%)',
        }}
      />

      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-[#fb6b04]/[0.08] rounded-full blur-[140px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-orange-700/[0.07] rounded-full blur-[120px]" />
      {success && (
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
  );
}
