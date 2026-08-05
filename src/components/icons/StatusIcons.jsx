/*
 * Iconos de estado en el mismo estilo que ClaudeIcon / OpenCodeIcon:
 * trazo de currentColor, sin relleno, decorativos por defecto.
 *
 * Reemplazan a los emojis que se usaban como iconos operativos: un emoji
 * cambia de forma segun el sistema, no hereda el color del estado y los
 * lectores de pantalla lo leen con su nombre literal.
 *
 * Cuando el icono es la unica forma de comunicar el estado, pasarle `label`
 * para que se anuncie como imagen con texto alternativo.
 */

function Svg({ size = 16, label, children }) {
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props) {
  return (
    <Svg {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

export function AlertIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.6 1.9 20.4h20.2L12 3.6Z" />
      <path d="M12 10v4" />
      <path d="M12 17.4h.01" />
    </Svg>
  );
}

export function DashIcon(props) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function BoltIcon(props) {
  return (
    <Svg {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Svg>
  );
}

export function HintIcon(props) {
  return (
    <Svg {...props}>
      <path d="M9 18h6" />
      <path d="M10 21.5h4" />
      <path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.7h6c0-.7.3-1.3.8-1.7A6.5 6.5 0 0 0 12 2.5Z" />
    </Svg>
  );
}
