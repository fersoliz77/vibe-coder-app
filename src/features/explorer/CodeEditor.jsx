import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';

function getCodeMirrorExtensions(extension) {
  const ext = (extension || '').replace('.', '').toLowerCase();
  switch (ext) {
    case 'js':
      return [javascript({ jsx: false, typescript: false })];
    case 'jsx':
      return [javascript({ jsx: true, typescript: false })];
    case 'ts':
      return [javascript({ jsx: false, typescript: true })];
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'json':
      return [json()];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
      return [css()];
    case 'md':
      return [markdown()];
    case 'py':
      return [python()];
    case 'sql':
      return [sql()];
    case 'yml':
    case 'yaml':
      return [yaml()];
    default:
      return [];
  }
}

export default function CodeEditor({ extension, value, onChange }) {
  return (
    <CodeMirror
      className="file-explorer__codemirror"
      value={value}
      height="100%"
      theme={oneDark}
      extensions={getCodeMirrorExtensions(extension)}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        foldGutter: true,
        autocompletion: true,
      }}
      onChange={onChange}
    />
  );
}
