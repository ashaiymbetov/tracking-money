/**
 * Высота приложения для каркаса (--app-h).
 *
 * В iOS 26 у веб-приложения, запущенного с экрана «Домой», Safari иногда отдаёт высоту окна
 * без нижней безопасной зоны — всё, что прижато к низу (таб-бар, шторки), «всплывает» вверх,
 * а под ним остаётся полоса. В standalone-режиме окно всегда во весь экран, поэтому берём
 * высоту экрана. В обычном Safari оставляем 100dvh (учитывает панели браузера).
 */
export function watchAppHeight() {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (!standalone) return;

  const apply = () => {
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const screenH = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const h = Math.max(screenH, window.innerHeight);
    document.documentElement.style.setProperty('--app-h', `${h}px`);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  // Иногда размеры приходят с опозданием после запуска — перепроверяем.
  setTimeout(apply, 300);
  setTimeout(apply, 1500);
}
