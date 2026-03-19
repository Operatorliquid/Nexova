import { defineConfig, type PluginOption } from 'vite';
import path from 'path';

async function resolveReactPlugin(): Promise<PluginOption[]> {
  try {
    const react = await import('@vitejs/plugin-react');
    return [react.default()];
  } catch {
    try {
      const reactSwc = await import('@vitejs/plugin-react-swc');
      return [reactSwc.default()];
    } catch {
      // Fallback to plain Vite if React plugins are not present in node_modules.
      return [];
    }
  }
}

export default defineConfig(async () => ({
  plugins: await resolveReactPlugin(),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    // Allow Cloudflare quick-tunnel hostnames to reach the dev server (avoid Vite's DNS rebinding protection 403).
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        cart: path.resolve(__dirname, 'cart/index.html'),
        register: path.resolve(__dirname, 'register/index.html'),
        verifyEmail: path.resolve(__dirname, 'verify-email/index.html'),
        checkout: path.resolve(__dirname, 'checkout/index.html'),
        checkoutContinue: path.resolve(__dirname, 'checkout/continue/index.html'),
        checkoutSuccess: path.resolve(__dirname, 'checkout/success/index.html'),
      },
    },
  },
}));
