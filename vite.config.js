import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Si falla por el plugin, quita la línea "plugins: [react()]"
export default defineConfig({
  plugins: [react()]
})
