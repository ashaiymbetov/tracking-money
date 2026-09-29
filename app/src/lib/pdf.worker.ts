// Воркер pdf.js с полифилом: сначала добавляем недостающее в Safari, потом запускаем сам воркер.
import './streamPolyfill';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
