/*
 * Paleta de xterm segun el tema de la aplicacion.
 *
 * La terminal estaba clavada en oscuro: con la app en claro quedaba un
 * rectangulo negro en medio de una interfaz de papel. xterm no lee variables
 * CSS —pinta sobre canvas—, asi que la paleta tiene que entrar como objeto.
 *
 * Los colores del texto sobre el fondo de cada tema cumplen AA; los de sintaxis
 * son los de la familia GitHub, elegidos para cada fondo.
 */

const DARK = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#58a6ff',
  selectionBackground: 'rgba(56, 139, 253, 0.3)',
  black: '#0d1117',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39d353',
  white: '#e6edf3',
  brightBlack: '#484f58',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d364',
  brightWhite: '#f0f6fc',
};

const LIGHT = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#0969da',
  selectionBackground: 'rgba(9, 105, 218, 0.18)',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#8a5b00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#0e5827',
  brightYellow: '#7a4a00',
  brightBlue: '#0550ae',
  brightMagenta: '#6639ba',
  brightCyan: '#166b70',
  brightWhite: '#1f2328',
};

/** @param {boolean} isDark */
export function xtermTheme(isDark) {
  return isDark ? { ...DARK } : { ...LIGHT };
}

export default xtermTheme;
