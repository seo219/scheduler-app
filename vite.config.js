import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/scheduler-app/',         // ← 리포지토리명과 동일
  build: {
    sourcemap: true,               // 에러 원인 추적에 도움 (선택)
  },
})