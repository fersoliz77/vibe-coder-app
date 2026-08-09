/*
 * Tema antes del primer pintado.
 *
 * La capa de tokens define el oscuro en `:root` y el claro en un selector
 * aparte. Si el tema se aplica desde React -en un efecto, o peor, despues de
 * leer la configuracion por IPC- el navegador ya pinto una pantalla oscura, y
 * todo usuario con preferencia clara ve un parpadeo garantizado en cada carga.
 *
 * Esto corre antes: es un script bloqueante en el `head`, sin `defer` ni
 * `type=module`, asi que se ejecuta y termina antes de que se pinte nada.
 *
 * Va en un archivo y no en linea porque los dos productos declaran
 * `script-src 'self'` y un script en linea quedaria bloqueado por CSP.
 *
 * Este archivo es identico en la web y en el escritorio: la preferencia se
 * resuelve igual en los dos, y `--vc-*` no puede depender de cual sea.
 */
(function () {
  var STORAGE_KEY = 'vibe-theme';
  var theme = null;

  /*
   * Lo que el usuario eligio gana. En el escritorio la fuente de verdad es la
   * configuracion local, que solo se puede leer por IPC y es asincrona: por eso
   * se refleja tambien aca, para que el proximo arranque no tenga que esperarla.
   */
  try {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') theme = stored;
  } catch (error) {
    /* almacenamiento bloqueado: se cae al sistema */
  }

  if (!theme) {
    try {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (error) {
      theme = 'dark';
    }
  }

  var root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  /*
   * Los dos nombres historicos que la capa de tokens todavia acepta. `body` no
   * existe a esta altura del documento, asi que van sobre `html`; `[data-theme]`
   * ya alcanza para los tokens, y estas clases cubren el CSS que aun mira el
   * nombre viejo.
   */
  var isLight = theme === 'light';
  root.classList.toggle('light-mode', isLight);
  root.classList.toggle('light-theme', isLight);
})();
