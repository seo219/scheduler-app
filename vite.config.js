import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',         // ← 루트 경로 배포이므로 이렇게
  build: {
    sourcemap: true, // 선택 사항
  },
})
