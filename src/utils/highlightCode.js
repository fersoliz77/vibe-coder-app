import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';

const LANGUAGE_BY_EXTENSION = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'css',
  html: 'markup',
  htm: 'markup',
  py: 'python',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bat: 'bash',
  ps1: 'bash',
};

export function highlightCode(content, extension) {
  const languageName = LANGUAGE_BY_EXTENSION[(extension || '').replace('.', '')] || 'clike';
  const grammar = Prism.languages[languageName] || Prism.languages.clike || Prism.languages.markup;
  return Prism.highlight(content || '', grammar, languageName);
}
