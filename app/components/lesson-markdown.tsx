import { Fragment, type ReactNode } from 'react';

// A deliberately small Markdown vocabulary for lesson prose. React escapes every
// text node; HTML, links, embeds and executable diagram languages stay literal.
export function LessonInline({ text }: { text: string }) {
  return <>{inline(text)}</>;
}

function inline(text: string, depth = 0): ReactNode[] {
  if (depth >= 5) return [text];
  const pattern = /\\([\\`*])|`([^`\n]+)`|\*\*(?=\S)([\s\S]*?\S)\*\*|\*(?=\S)([^*\n]*?\S)\*/g;
  const parts: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    if (start > end) parts.push(text.slice(end, start));
    const [, escaped, code, bold, emphasis] = match;
    if (escaped !== undefined) parts.push(escaped);
    else if (code !== undefined) parts.push(<code key={start}>{code}</code>);
    else if (bold !== undefined) parts.push(<strong key={start}>{inline(bold, depth + 1)}</strong>);
    else parts.push(<em key={start}>{inline(emphasis, depth + 1)}</em>);
    end = start + match[0].length;
  }
  if (end < text.length) parts.push(text.slice(end));
  return parts;
}

const listItem = (line: string) => /^\s*(?:[-+*]|\d+[.)])\s+(.+)$/.exec(line);
const heading = (line: string) => /^#{1,4}\s+(.+)$/.exec(line);
const quote = (line: string) => /^>\s?(.*)$/.exec(line);
const ordered = (line: string) => /^\s*\d+[.)]\s/.test(line);
const beginsBlock = (line: string) =>
  !line.trim() || listItem(line) || heading(line) || quote(line);

export default function LessonMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    const title = heading(lines[i]);
    if (title) {
      blocks.push(<h3 key={start}>{inline(title[1])}</h3>);
      i++;
      continue;
    }
    if (listItem(lines[i])) {
      const numbered = ordered(lines[i]);
      const items: ReactNode[] = [];
      const first = /^\s*(\d+)/.exec(lines[i]);
      while (i < lines.length && listItem(lines[i]) && ordered(lines[i]) === numbered) {
        items.push(<li key={i}>{inline(listItem(lines[i])![1])}</li>);
        i++;
      }
      blocks.push(
        numbered ? (
          <ol key={start} start={Number(first![1])}>
            {items}
          </ol>
        ) : (
          <ul key={start}>{items}</ul>
        ),
      );
      continue;
    }
    if (quote(lines[i])) {
      const content = [];
      while (i < lines.length && quote(lines[i])) {
        content.push(quote(lines[i])![1]);
        i++;
      }
      blocks.push(
        <blockquote key={start}>
          <p>{inline(content.join('\n'))}</p>
        </blockquote>,
      );
      continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && !beginsBlock(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={start}>{inline(paragraph.join('\n'))}</p>);
  }
  return (
    <div className="lesson-markdown">
      {blocks.map((block, n) => (
        <Fragment key={n}>{block}</Fragment>
      ))}
    </div>
  );
}
