/* El rotor del logo se mueve como uno de verdad: el scroll le da impulso,
   gira con inercia y, al parar, oscila hasta volver a su sitio.
   Con «reducir movimiento» activado se queda quieto. */
(() => {
  const rotors = [...document.querySelectorAll('[data-rotor]')];
  if (!rotors.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const REST = -35;           // pose del logo
  let angle = REST, speed = 0, lastY = scrollY, running = false;

  const frame = () => {
    // muelle suave hacia la pose más cercana (múltiplo de 360°) + rozamiento
    const target = REST + 360 * Math.round((angle - REST) / 360);
    speed += (target - angle) * 0.004;
    speed *= 0.965;
    angle += speed;
    for (const r of rotors) r.setAttribute('transform', `rotate(${angle.toFixed(2)} 256 256)`);
    if (Math.abs(speed) < 0.01 && Math.abs(target - angle) < 0.05) { running = false; return; }
    requestAnimationFrame(frame);
  };
  const kick = v => {
    speed = Math.max(-28, Math.min(28, speed + v));
    if (!running) { running = true; requestAnimationFrame(frame); }
  };
  addEventListener('scroll', () => { const y = scrollY; kick((y - lastY) * 0.09); lastY = y; }, { passive: true });
  // Un pequeño balanceo al cargar, como al coger el reloj
  setTimeout(() => kick(9), 450);
  // Tocar el rotor también lo hace girar
  document.querySelectorAll('[data-rotor-tap]').forEach(el => el.addEventListener('click', () => kick(22)));
})();

/* Sugerencia discreta de idioma (sin redirigir: es peor para Google y para el usuario) */
(() => {
  const hint = document.querySelector('[data-lang-hint]');
  if (!hint) return;
  let seen = false;
  try { seen = localStorage.getItem('rotorweb_lang_hint') === '1'; } catch {}
  const page = document.documentElement.lang.slice(0, 2);
  const want = (navigator.language || '').slice(0, 2).toLowerCase();
  const tpl = hint.querySelector(`template[data-for="${want}"]`);
  if (seen || want === page || !tpl || document.referrer.includes(location.host)) return;
  hint.prepend(tpl.content.cloneNode(true));
  hint.hidden = false;
  hint.querySelector('button').addEventListener('click', () => {
    hint.hidden = true;
    try { localStorage.setItem('rotorweb_lang_hint', '1'); } catch {}
  });
})();
