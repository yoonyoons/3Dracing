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
        manualChunks: { three: ['three', '@react-three/fiber'], supabase: ['@supabase/supabase-js'] },
      },
    },
  },
});
