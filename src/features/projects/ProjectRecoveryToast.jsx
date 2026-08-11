import { useI18n } from '../../i18n/I18nContext';
import './ProjectRecoveryToast.css';

const COPY = {
  en: { recovered: ['Projects restored', '{{count}} project(s) restored from the last valid copy.'], repaired: ['Project list repaired', 'Invalid data removed. {{count}} project(s) remain.'], unavailable: ['Project list needs attention', 'No valid copy was available. Project folders were not changed.'], dismiss: 'Understood' },
  es: { recovered: ['Proyectos restaurados', '{{count}} proyecto(s) restaurados desde la última copia válida.'], repaired: ['Lista reparada', 'Se quitaron datos inválidos. Quedan {{count}} proyecto(s).'], unavailable: ['La lista necesita revisión', 'No había una copia válida. Las carpetas no cambiaron.'], dismiss: 'Entendido' },
};

export default function ProjectRecoveryToast({ recovery, onDismiss }) {
  const { language } = useI18n();
  if (!recovery) return null;
  const copy = COPY[language] || COPY.en;
  const [title, message] = copy[recovery.status];
  return (
    <aside className={`vc-toast project-recovery-toast is-${recovery.status}`} role="status" aria-live="polite">
      <strong>{title}</strong>
      <p>{message.replace('{{count}}', recovery.projectCount)}</p>
      <button type="button" onClick={onDismiss}>{copy.dismiss}</button>
    </aside>
  );
}
