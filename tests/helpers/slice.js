import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// public/ has no build step, so the page can't import from src/ and tests can't import
// from the page. Instead, cut the code out of the real file between two anchor strings
// and evaluate it. The throw matters: without it, a renamed anchor would quietly yield
// an empty block and tests that assert nothing.
export function sliceFunctions(file, startAnchor, endAnchor, exportNames, { prelude = '', inject = {} } = {}) {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start + 1);
  if (start === -1 || end === -1) throw new Error(`Couldn't find the block in ${file} — has it moved? (${startAnchor} … ${endAnchor})`);
  const body = `${prelude}\n${source.slice(start, end)}\nreturn { ${exportNames.join(', ')} };`;
  return new Function(...Object.keys(inject), body)(...Object.values(inject));
}
