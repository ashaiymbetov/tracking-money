/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages отдаёт сайт по адресу https://<user>.github.io/<repo>/
const base = process.env.VITE_BASE ?? '/tracking-money/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Расходы',
        short_name: 'Расходы',
        description: 'Куда уходят деньги: MBank, O!Bank, Simbank',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        background_color: '#0f0f0e',
        theme_color: '#0f0f0e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Данные всегда берём из сети (Apps Script), кэшируем только само приложение.
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // pdf.js (~1,8 МБ) нужен только для импорта выписки — не кладём его в офлайн-кэш при установке
        globIgnores: ['**/pdf*.{js,mjs}', '**/statement-*.js']
      }
    })
  ],
  test: {
    environment: 'node'
  }
});
