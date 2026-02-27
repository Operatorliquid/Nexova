import { useEffect, useRef } from 'react';

type Props = {
  className?: string;
  seed?: number;
};

// ─── WebGL helpers ────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[FluidBg] Shader error:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function createProgram(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vs);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  if (!vert || !frag) {
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
    return null;
  }
  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return null;
  }
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[FluidBg] Link error:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

/**
 * Mesh-gradient fluid via Inverse Distance Weighting (IDW).
 *
 * Mouse interaction has two parts:
 *   1. PUSH  — radial UV warp away from cursor (no velocity needed, no jank).
 *   2. TRAIL — luminous streak drawn along the segment from ghost→current.
 *              The "ghost" position (uMousePrev) is a heavily-lagged copy of
 *              the cursor passed from JS, so the segment is always long enough
 *              to be clearly visible when moving, and fades when idle.
 */
const FRAG = /* glsl */ `
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
    float push   = uMouseEnergy * 0.07 * exp(-mDist * mDist / 0.028);
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
    float speed   = clamp(segLen * 5.0, 0.0, 1.0);   /* 0 when idle, 1 when fast */

    /* Distance from uv to the ghost→cursor segment */
    vec2  segN    = seg / (segLen + 0.0001);
    float proj    = clamp(dot(uv - uMouseGhost, segN), 0.0, segLen);
    vec2  closest = uMouseGhost + segN * proj;
    float tDist   = length(uv - closest);

    /* Trail width: thinner when slow, wider when fast */
    float tWidth  = 0.014 + speed * 0.020;
    float trail   = uMouseEnergy * speed * exp(-(tDist * tDist) / (tWidth * tWidth));
    color += vec3(0.75, 0.42, 0.10) * trail * 0.55;  /* subtler intensity */

    /* ── Cursor glow / bloom ── */
    float glow = uMouseEnergy * 0.35 * exp(-mDist * mDist / 0.005);
    color += vec3(1.00, 0.70, 0.25) * glow;

    /* ── Soft vignette ── */
    vec2  vc  = uv * 2.0 - 1.0;
    float vig = smoothstep(1.70, 0.30, length(vc));
    color *= mix(0.80, 1.0, vig);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function FluidOrangeBackground({ className = '', seed = 0 }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Respect prefers-reduced-motion — skip WebGL, CSS fallback shows instead
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const gl = canvas.getContext('webgl', {
      alpha: false,           // opaque — no compositing cost
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const program = createProgram(gl, VERT, FRAG);
    if (!program) return;

    const buf = gl.createBuffer();
    if (!buf) { gl.deleteProgram(program); return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const aPos       = gl.getAttribLocation(program,  'aPosition');
    const uRes       = gl.getUniformLocation(program, 'uResolution');
    const uTimeLoc   = gl.getUniformLocation(program, 'uTime');
    const uSeedLoc   = gl.getUniformLocation(program, 'uSeed');
    const uMouseLoc  = gl.getUniformLocation(program, 'uMouse');
    const uGhostLoc  = gl.getUniformLocation(program, 'uMouseGhost');
    const uEnergyLoc = gl.getUniformLocation(program, 'uMouseEnergy');

    // ── Pointer state ──────────────────────────────────────────────────────────
    // target  : raw pointer position (updated on pointermove)
    // current : fast-follow of target   (lerp α = 0.14/frame) → uMouse
    // ghost   : slow-follow of current  (lerp α = 0.05/frame) → uMouseGhost
    //
    // The segment  ghost → current  is always proportional to recent speed,
    // so the trail is clearly visible when moving and fades naturally when idle.
    const target  = { x: 0.5, y: 0.5 };
    const current = { x: 0.5, y: 0.5 };
    const ghost   = { x: 0.5, y: 0.5 };
    let energy   = 0;
    let lastMove = performance.now();

    const onPointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (
        e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom
      ) return;
      target.x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      target.y = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
      energy   = 1;
      lastMove = performance.now();
    };

    const resize = (): void => {
      // Read from parentElement — canvas.clientHeight can be 0 when the
      // containing div has conflicting position classes in Tailwind's cascade.
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(parent.clientWidth  * dpr));
      const h = Math.max(1, Math.floor(parent.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
      }
    };

    const start = performance.now();
    let rafId   = 0;

    const render = (now: number): void => {
      resize();

      // Decay energy when idle (half-life ≈ 600ms at 60fps)
      if (now - lastMove > 60) energy *= 0.968; /* faster energy decay = snappier feel */

      // current  → fast follow (smooth cursor position)
      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;

      // ghost → slow follow (trail anchor, ~200ms behind cursor at normal speed)
      ghost.x += (current.x - ghost.x) * 0.05;
      ghost.y += (current.y - ghost.y) * 0.05;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(uRes,     canvas.width, canvas.height);
      gl.uniform1f(uTimeLoc, (now - start) * 0.001);
      gl.uniform1f(uSeedLoc, seed);
      gl.uniform2f(uMouseLoc,  current.x, current.y);
      gl.uniform2f(uGhostLoc,  ghost.x,   ghost.y);
      gl.uniform1f(uEnergyLoc, clamp(energy, 0, 1));

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafId = window.requestAnimationFrame(render);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('resize', resize);
    resize();
    rafId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', resize);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
    };
  }, [seed]);

  return (
    // No 'relative' here — it would override 'absolute' from className in Tailwind's
    // cascade (alphabetical order: .absolute < .relative), collapsing height to 0.
    // Positioning is fully delegated to the className prop.
    <div
      className={`overflow-hidden ${className}`}
      style={{ background: 'linear-gradient(135deg, #3d0800 0%, #c43500 40%, #ff5200 70%, #ff8a18 100%)' }}
      aria-hidden
    >
      {/* Inline style for canvas avoids any Tailwind cascade surprises */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
