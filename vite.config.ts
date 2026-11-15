import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 5_000_000 },
      manifest: {
        name: 'Encore – Karaoke',
        short_name: 'Encore',
        description: 'Karaoke mit eigenen Songs, Live-Tonhöhenerkennung und Bewertung',
        lang: 'de',
        theme_color: '#0b0714',
        background_color: '#0b0714',
        display: 'fullscreen',
        orientation: 'any',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  worker: { format: 'es' },
})
