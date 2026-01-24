/**
 * Fix broken accents (mojibake) in text files.
 *
 * Goal: normalize project files to UTF-8 (without BOM) and fix common
 * Windows-1252/ISO-8859-1 -> UTF-8 mojibake sequences.
 *
 * It only changes textual content; no code logic is intentionally modified.
 * Still, review the diff after running.
 *
 * Usage (from repo root):
 *   node tools/fix-accents.js
 *
 * Options:
 *   --dry-run   Do not write changes, only report.
 *   --path <p>  Root path (default: repo root)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function getArgValue(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx === -1) return defaultValue;
  const v = args[idx + 1];
  return v ? v : defaultValue;
}

const ROOT = path.resolve(getArgValue('--path', path.join(__dirname, '..')));

const SKIP_DIRS = new Set(['.git', 'node_modules', '.vscode']);
const TEXT_EXTS = new Set([
  '.js', '.gs', '.json', '.html', '.css', '.md', '.txt'
]);

// Common mojibake patterns (UTF-8 decoded as Latin-1/CP1252)
// Keep this mapping conservative to avoid accidental changes.
const REPLACEMENTS = new Map([
  ['Ã¡', 'á'], ['Ã ', 'à'], ['Ã¢', 'â'], ['Ã£', 'ã'], ['Ã¤', 'ä'],
  ['Ã©', 'é'], ['Ã¨', 'è'], ['Ãª', 'ê'], ['Ã«', 'ë'],
  ['Ã­', 'í'], ['Ã¬', 'ì'], ['Ã®', 'î'], ['Ã¯', 'ï'],
  ['Ã³', 'ó'], ['Ã²', 'ò'], ['Ã´', 'ô'], ['Ãµ', 'õ'], ['Ã¶', 'ö'],
  ['Ãº', 'ú'], ['Ã¹', 'ù'], ['Ã»', 'û'], ['Ã¼', 'ü'],
  ['Ã‡', 'Ç'], ['Ã§', 'ç'],
  ['Ã', 'Í'], ['Ã', 'Ï'],
  ['Ã“', 'Ó'], ['Ã”', 'Ô'], ['Ã•', 'Õ'],
  ['Ãš', 'Ú'],
  ['Ã±', 'ñ'],

  // Quotes / dashes
  ['â€œ', '“'], ['â€', '”'], ['â€', '”'], ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],

  ['â€', '”'],
  ['â€', '”'],
  ['â€', '”'],

  ['â€œ', '“'],
  ['â€', '”'],
  ['â€˜', '‘'], ['â€™', '’'],
  ['â€“', '–'], ['â€”', '—'],

  // Ellipsis / bullets
  ['â€¦', '…'],
  ['â€¢', '•'],

  // NBSP
  ['Â ', ' '],

  // Specific sequences observed in the repo (examples)
  ['COMECANDO', 'COMEÇANDO'],
  ['CONCLUDO', 'CONCLUÍDO'],
  ['recorrǦncias', 'recorrências'],
  ['usuǭrio', 'usuário'],
  ['nǜo', 'não']
]);

function shouldProcessFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTS.has(ext)) return false;
  const base = path.basename(filePath);
  // keep clasp / apps script config as text
  if (base === '.clasp.json' || base === 'appsscript.json') return true;
  return true;
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      if (shouldProcessFile(full)) out.push(full);
    }
  }
  return out;
}

function stripBOM(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function applyReplacements(content) {
  let out = content;
  for (const [from, to] of REPLACEMENTS.entries()) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

function main() {
  const files = walk(ROOT);
  let changedFiles = 0;
  let totalReplacements = 0;

  for (const f of files) {
    let buf;
    try {
      buf = fs.readFileSync(f);
    } catch {
      continue;
    }

    // Try to decode as UTF-8 (most projects). If file is actually CP1252,
    // it will still decode but with replacement chars. We keep mapping-based fixes only.
    let content = buf.toString('utf8');
    const original = content;

    // normalize
    content = stripBOM(content);

    // fix mojibake sequences
    const fixed = applyReplacements(content);

    if (fixed !== original) {
      changedFiles++;

      // count approximate number of changes
      for (const [from] of REPLACEMENTS.entries()) {
        const m = original.split(from).length - 1;
        if (m > 0) totalReplacements += m;
      }

      if (!DRY_RUN) {
        fs.writeFileSync(f, fixed, { encoding: 'utf8' });
      }

      const rel = path.relative(ROOT, f);
      process.stdout.write(`${DRY_RUN ? '[dry-run] ' : ''}fixed: ${rel}\n`);
    }
  }

  process.stdout.write(`\nDone. Files changed: ${changedFiles}. Approx replacements: ${totalReplacements}.\n`);
  if (DRY_RUN) {
    process.stdout.write('Dry-run mode: no files were written.\n');
  }
}

main();
