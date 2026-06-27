import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages はサブパス配信になるため base をリポジトリ名に合わせる。
// 公開URL: https://shitake-zense.github.io/versus-bull-3D/
// 独自ドメインやルート配信にする場合は base を '/' に変更すること。
export default defineConfig({
  base: '/versus-bull-3D/',
  plugins: [react()],
  build: {
    // 重いベンダーを分割してキャッシュ効率を上げ、巨大単一チャンク警告を解消する。
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
          firebase: ['firebase/app', 'firebase/database'],
          react: ['react', 'react-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
