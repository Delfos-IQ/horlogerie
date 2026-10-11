/* theme-boot.js — applies the theme chosen in Ajustes before the first paint
   (classic script in <head>; the full logic lives in js/i18n.js). */
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('rotor_prefs_v1') || '{}');
    if (p.theme === 'light' || p.theme === 'dark') document.documentElement.setAttribute('data-theme', p.theme);
  } catch (e) { /* private mode: follow the system */ }
})();
