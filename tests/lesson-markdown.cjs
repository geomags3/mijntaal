const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server');
const file = path.resolve(__dirname, '../app/components/lesson-markdown.tsx'),
  output = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  { exports: output, require },
  { filename: file },
);
const render = (text) => renderToStaticMarkup(React.createElement(output.default, { text }));
const inline = (text) => renderToStaticMarkup(React.createElement(output.LessonInline, { text }));
assert.equal(inline('Start with `ik`.'), 'Start with <code>ik</code>.');
assert.equal(inline('**Your answer:** *fiets*'), '<strong>Your answer:</strong> <em>fiets</em>');
assert.equal(inline('Use **`ik`** here.'), 'Use <strong><code>ik</code></strong> here.');
assert.equal(inline('Escaped \\`ik\\` and \\*literal\\*'), 'Escaped `ik` and *literal*');
assert.equal(inline('Ik ___ naar huis. snake_case'), 'Ik ___ naar huis. snake_case');
assert.equal(inline('Unclosed **word and `code'), 'Unclosed **word and `code');
const html = render(
  '### A little Dutch\n\n> **Ik fiets.**\n> *I cycle.*\n\n- `ik` means I\n- `fiets` means cycle\n\n3. Build a sentence\n4. Check it\n\nA final paragraph.\nAnd another line.',
);
assert.match(html, /<h3>A little Dutch<\/h3>/);
assert.match(
  html,
  /<blockquote><p><strong>Ik fiets\.<\/strong>\n<em>I cycle\.<\/em><\/p><\/blockquote>/,
);
assert.match(html, /<ul><li><code>ik<\/code> means I<\/li>/);
assert.match(html, /<ol start="3"><li>Build a sentence<\/li>/);
assert.match(html, /<p>A final paragraph\.\nAnd another line\.<\/p>/);
const unsafe = render(
  '<img src=x onerror="alert(1)">\n\n**<script>alert(1)</script>**\n\n[click](javascript:alert(1))\n\n`<svg onload=alert(1)>`',
);
assert.ok(!/<(?:img|script|svg|a)[\s>]/.test(unsafe));
assert.match(unsafe, /&lt;img/);
assert.match(unsafe, /<strong>&lt;script&gt;/);
assert.match(unsafe, /<code>&lt;svg/);
assert.ok(unsafe.includes('[click](javascript:alert(1))'));
console.log(
  'PASS: compact lesson Markdown, inline highlighting, structured prose, escaped delimiters and inert HTML/links.',
);
