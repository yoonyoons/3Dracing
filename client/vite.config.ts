import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 자주 바뀌지 않는 큰 라이브러리를 따로 묶어 다시 배포해도 캐시가 남게 합니다.
        // (three.js 는 3D 화면을 열 때만 불러오도록 lazy import 가 알아서 나눕니다)
        manualChunks(id) {
          if (id.includes('/node_modules/@supabase/')) return 'supabase';
          // three.js 자체 파일만 묶습니다(react 등은 넣지 않아야 첫 화면이 three 를 기다리지 않음).
          if (id.includes('/node_modules/three/')) return 'three';
          return undefined;
        },
      },
    },
  },
});
