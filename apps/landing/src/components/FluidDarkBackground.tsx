import { useEffect, useRef } from 'react';

type Props = {
  className?: string;
  seed?: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vs);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  if (!vert || !frag) {
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return null;
  }

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

const VERT = /* glsl */ `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
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

    float glow = uMouseEnergy * 0.18 * exp(-mDist * mDist / 0.008);
    color += vec3(0.18, 0.14, 0.45) * glow;

    vec2  vc  = uv * 2.0 - 1.0;
    float vig = smoothstep(1.6, 0.4, length(vc));
    color *= mix(0.85, 1.0, vig);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export default function FluidDarkBackground({ className = '', seed = 0 }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const program = createProgram(gl, VERT, FRAG);
    if (!program) return;

    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, 'aPosition');
    const uResolution = gl.getUniformLocation(program, 'uResolution');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uSeed = gl.getUniformLocation(program, 'uSeed');
    const uMouse = gl.getUniformLocation(program, 'uMouse');
    const uMouseGhost = gl.getUniformLocation(program, 'uMouseGhost');
    const uMouseEnergy = gl.getUniformLocation(program, 'uMouseEnergy');

    const target = { x: 0.5, y: 0.5 };
    const current = { x: 0.5, y: 0.5 };
    const ghost = { x: 0.5, y: 0.5 };
    let energy = 0;
    let lastMove = performance.now();

    const onPointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return;
      }

      target.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      target.y = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
      energy += (1 - energy) * 0.05;
      lastMove = performance.now();
    };

    const resize = (): void => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(parent.clientWidth * dpr));
      const h = Math.max(1, Math.floor(parent.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const start = performance.now();
    let raf = 0;

    const frame = (ts: number): void => {
      resize();

      if (ts - lastMove > 200) {
        energy *= 0.993;
      }

      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;
      ghost.x += (current.x - ghost.x) * 0.04;
      ghost.y += (current.y - ghost.y) * 0.04;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

      if (uResolution) gl.uniform2f(uResolution, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, (ts - start) * 0.001);
      if (uSeed) gl.uniform1f(uSeed, seed);
      if (uMouse) gl.uniform2f(uMouse, current.x, current.y);
      if (uMouseGhost) gl.uniform2f(uMouseGhost, ghost.x, ghost.y);
      if (uMouseEnergy) gl.uniform1f(uMouseEnergy, clamp(energy, 0, 1));

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = window.requestAnimationFrame(frame);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('resize', resize);
    resize();
    raf = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', resize);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [seed]);

  return (
    <div
      className={`overflow-hidden ${className}`}
      style={{
        background:
          'linear-gradient(135deg, #020210 0%, #06061a 40%, #0a0a28 70%, #050518 100%)',
      }}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  );
}
