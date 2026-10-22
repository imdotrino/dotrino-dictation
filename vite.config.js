// Solo para la demo y las pruebas e2e. El paquete se publica como fuente (src/).
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'demo',
  base: './',
  build: { outDir: '../dist-demo', emptyOutDir: true },
  // El worker usa imports dinámicos: tiene que salir como módulo, no como IIFE.
  worker: { format: 'es' },
  // Pre-empaquetar rompe el `new URL('./worker.js', import.meta.url)` del paquete.
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
  server: { port: 3151 },
})
