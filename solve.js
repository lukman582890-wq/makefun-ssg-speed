// Ultra-fast, dependency-free, 100% byte-identical drop-in for makefun-site 1.0.0 (Rev 2).

const REPORT_FILE = 'build-report.txt';
const RESERVED = ['posts', 'tags', 'page'];
const SLUG_MAX = 64;
const INCLUDE_DEPTH = 8;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- fast text helpers

const ESCAPE_TEST = /[&<>"']/;
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESCAPE_REPL = /[&<>"']/g;

function escapeHtml(s) {
  if (!ESCAPE_TEST.test(s)) return s;
  if (s.length > 64) return s.replace(ESCAPE_REPL, (c) => ESCAPE_MAP[c]);
  const len = s.length;
  let out = '';
  let last = 0;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (c > 62) continue;
    let rep;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    else continue;
    if (last < i) out += s.slice(last, i);
    out += rep;
    last = i + 1;
  }
  return last < len ? out + s.slice(last) : out;
}

const SLUG_BUF = new Uint8Array(SLUG_MAX);

function slugifySlow(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
    if (out.length >= SLUG_MAX) break;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

function slugify(text) {
  const n = text.length;
  let len = 0;
  let gap = false;
  for (let i = 0; i < n; i++) {
    let c = text.charCodeAt(i);
    if (c >= 128) return slugifySlow(text);
    if (c >= 65 && c <= 90) c += 32;
    else if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
      if (len > 0) gap = true;
      continue;
    }
    if (gap) {
      if (len >= SLUG_MAX - 1) break;
      SLUG_BUF[len++] = 45;
      gap = false;
    }
    SLUG_BUF[len++] = c;
    if (len === SLUG_MAX) break;
  }
  if (len === 0) return 'untitled';
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(SLUG_BUF[i]);
  return s;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(date) {
  const m = (date.charCodeAt(5) - 48) * 10 + (date.charCodeAt(6) - 48);
  const d = (date.charCodeAt(8) - 48) * 10 + (date.charCodeAt(9) - 48);
  return `${d} ${MONTHS[m - 1]} ${date.slice(0, 4)}`;
}

function isUnicodeWs(c) {
  return (
    c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f ||
    c === 0x3000 || c === 0xfeff
  );
}

function wordsOf(text) {
  const n = text.length;
  let count = 0;
  let i = 0;
  while (i < n) {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c <= 32 ? (c !== 32 && (c < 9 || c > 13)) : (c < 160 || !isUnicodeWs(c))) break;
      i++;
    }
    if (i >= n) break;
    count++;
    i++;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c <= 32 ? (c === 32 || (c >= 9 && c <= 13)) : (c >= 160 && isUnicodeWs(c))) break;
      i++;
    }
  }
  return count;
}

function hasWhitespace(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 32 ? (c === 32 || (c >= 9 && c <= 13)) : (c >= 160 && isUnicodeWs(c))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- front matter

const FM_KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const FM_LINE = /^([a-z_]+):(?: (.*))?$/;
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FM_TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) {
      return { error: 'a quoted string is not closed' };
    }
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) {
          return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        }
        out += n;
        i++;
      } else if (c === '"') {
        return { error: 'a quoted string holds a stray quote' };
      } else {
        out += c;
      }
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = FM_DATE.exec(raw);
      if (!m) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) {
        return { error: 'key "tags": not a list [a, b]' };
      }
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (let i = 0; i < tags.length; i++) {
        if (tags[i] === '' || !FM_TAG.test(tags[i])) {
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return FM_NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return FM_SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankSlice(s, start, end) {
  for (let i = start; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function parseFrontMatter(text) {
  const len = text.length;
  let nl = text.indexOf('\n');
  const firstEnd = nl === -1 ? len : nl;
  if (firstEnd !== 3 || text.charCodeAt(0) !== 45 || text.charCodeAt(1) !== 45 || text.charCodeAt(2) !== 45) {
    return { error: 'no front matter' };
  }
  if (nl === -1) return { error: 'the front matter is not closed' };

  let pos = nl + 1;
  let lineNum = 2;
  const data = {};
  let closeEnd = -1;

  while (pos <= len) {
    nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    if (lineEnd - pos === 3 && text.charCodeAt(pos) === 45 && text.charCodeAt(pos + 1) === 45 && text.charCodeAt(pos + 2) === 45) {
      closeEnd = lineEnd;
      break;
    }
    if (nl === -1) break;

    if (!isBlankSlice(text, pos, lineEnd) && text.charCodeAt(pos) !== 35) {
      const line = text.slice(pos, lineEnd);
      const m = FM_LINE.exec(line);
      if (!m) return { error: `line ${lineNum} is not "key: value"` };
      const key = m[1];
      let raw = m[2] ?? '';
      let rEnd = raw.length;
      while (rEnd > 0 && (raw.charCodeAt(rEnd - 1) === 32 || raw.charCodeAt(rEnd - 1) === 9)) rEnd--;
      if (rEnd < raw.length) raw = raw.slice(0, rEnd);
      if (!FM_KEYS.has(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }

    pos = nl + 1;
    lineNum++;
  }

  if (closeEnd === -1) return { error: 'the front matter is not closed' };
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = closeEnd >= len ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

// ---------------------------------------------------------------- markdown

const IS_ESCAPABLE = new Uint8Array(128);
for (const ch of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) {
  IS_ESCAPABLE[ch.charCodeAt(0)] = 1;
}

const INLINE_TEST = /[\\`*[&<>"']/;

function findUnescapedDoubleStar(s, from) {
  const limit = s.length - 2;
  for (let j = from; j <= limit; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < s.length) {
      const nc = s.charCodeAt(j + 1);
      if (nc < 128 && IS_ESCAPABLE[nc] === 1) {
        j++;
        continue;
      }
    }
    if (c === 42 && s.charCodeAt(j + 1) === 42) return j;
  }
  return -1;
}

function findUnescapedBracket(s, from) {
  const len = s.length;
  for (let j = from; j < len; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < len) {
      const nc = s.charCodeAt(j + 1);
      if (nc < 128 && IS_ESCAPABLE[nc] === 1) {
        j++;
        continue;
      }
    }
    if (c === 93) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  const len = s.length;
  for (let j = from; j < len; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < len) {
      const nc = s.charCodeAt(j + 1);
      if (nc < 128 && IS_ESCAPABLE[nc] === 1) {
        j++;
        continue;
      }
    }
    if (c !== 42) continue;
    if (j + 1 < len && s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

function inline(s, env) {
  if (!INLINE_TEST.test(s)) return s;
  const re = /[\\`*[&<>"']/g;
  const len = s.length;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const i = m.index;
    const c = s.charCodeAt(i);
    if (c === 92) { // '\'
      if (i + 1 < len) {
        const nc = s.charCodeAt(i + 1);
        if (nc < 128 && IS_ESCAPABLE[nc] === 1) {
          if (last < i) out += s.slice(last, i);
          out += nc === 62 ? '&gt;' : s[i + 1];
          last = i + 2;
          re.lastIndex = last;
        }
      }
    } else if (c === 96) { // '`'
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (last < i) out += s.slice(last, i);
        out += `<code>${escapeHtml(s.slice(i + 1, j))}</code>`;
        last = j + 1;
        re.lastIndex = last;
      }
    } else if (c === 42) { // '*'
      if (i + 1 < len && s.charCodeAt(i + 1) === 42) {
        const j = findUnescapedDoubleStar(s, i + 2);
        if (j > i + 2) {
          if (last < i) out += s.slice(last, i);
          out += `<strong>${inline(s.slice(i + 2, j), env)}</strong>`;
          last = j + 2;
          re.lastIndex = last;
        } else {
          re.lastIndex = i + 2;
        }
      } else {
        const j = findSingleStar(s, i + 1);
        if (j > i + 1) {
          if (last < i) out += s.slice(last, i);
          out += `<em>${inline(s.slice(i + 1, j), env)}</em>`;
          last = j + 1;
          re.lastIndex = last;
        }
      }
    } else if (c === 91) { // '['
      const k = findUnescapedBracket(s, i + 1);
      const closeParen = k !== -1 && k + 1 < len && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = closeParen === -1 ? '' : s.slice(k + 2, closeParen);
      if (target !== '' && !hasWhitespace(target)) {
        if (last < i) out += s.slice(last, i);
        out += `<a href="${escapeHtml(env.link(target))}">${inline(s.slice(i + 1, k), env)}</a>`;
        last = closeParen + 1;
        re.lastIndex = last;
      }
    } else {
      // & < > " '
      let rep;
      if (c === 38) rep = '&amp;';
      else if (c === 60) rep = '&lt;';
      else if (c === 62) rep = '&gt;';
      else if (c === 34) rep = '&quot;';
      else rep = '&#39;';
      if (last < i) out += s.slice(last, i);
      out += rep;
      last = i + 1;
    }
  }
  if (last === 0) return s;
  if (last < len) out += s.slice(last);
  return out;
}

function trimSlice(s, start, end) {
  while (start < end && (s.charCodeAt(start) === 32 || s.charCodeAt(start) === 9)) start++;
  while (end > start && (s.charCodeAt(end - 1) === 32 || s.charCodeAt(end - 1) === 9)) end--;
  return s.slice(start, end);
}

function matchFenceOpen(s, start, end) {
  if (end - start < 3 || s.charCodeAt(start) !== 96 || s.charCodeAt(start + 1) !== 96 || s.charCodeAt(start + 2) !== 96) {
    return null;
  }
  let p = start + 3;
  while (p < end) {
    const c = s.charCodeAt(p);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) {
      p++;
    } else break;
  }
  if (!isBlankSlice(s, p, end)) return null;
  return s.slice(start + 3, p);
}

function isFenceClose(s, start, end) {
  return end - start >= 3 && s.charCodeAt(start) === 96 && s.charCodeAt(start + 1) === 96 && s.charCodeAt(start + 2) === 96 && isBlankSlice(s, start + 3, end);
}

function matchHeading(s, start, end) {
  let depth = 0;
  let p = start;
  while (p < end && depth < 6 && s.charCodeAt(p) === 35) {
    depth++;
    p++;
  }
  if (depth === 0 || p >= end) return null;
  const c = s.charCodeAt(p);
  if (c !== 32 && c !== 9) return null;
  while (p < end && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9)) p++;
  let e = end;
  while (e > p && (s.charCodeAt(e - 1) === 32 || s.charCodeAt(e - 1) === 9)) e--;
  if (e === p) return null;
  return { depth, text: s.slice(p, e) };
}

function isHr(s, start, end) {
  if (end - start < 3) return false;
  const c = s.charCodeAt(start);
  if ((c === 45 || c === 42) && s.charCodeAt(start + 1) === c && s.charCodeAt(start + 2) === c) {
    return isBlankSlice(s, start + 3, end);
  }
  return false;
}

function isContinued(s, start, end) {
  if (end - start < 3 || s.charCodeAt(start) !== 32 || s.charCodeAt(start + 1) !== 32) return false;
  let p = start + 2;
  while (p < end && s.charCodeAt(p) === 32) p++;
  if (p >= end) return false;
  const c = s.charCodeAt(p);
  return !(c <= 32 ? (c === 32 || (c >= 9 && c <= 13)) : (c >= 160 && isUnicodeWs(c)));
}

function matchBullet(s, start, end) {
  if (end - start < 2) return null;
  const c = s.charCodeAt(start);
  if ((c === 45 || c === 42) && s.charCodeAt(start + 1) === 32) {
    return trimSlice(s, start + 2, end);
  }
  return null;
}

function matchOrdered(s, start, end) {
  let p = start;
  let digits = 0;
  while (p < end && digits < 9) {
    const c = s.charCodeAt(p);
    if (c >= 48 && c <= 57) {
      p++;
      digits++;
    } else break;
  }
  if (digits === 0 || p + 1 >= end || s.charCodeAt(p) !== 46 || s.charCodeAt(p + 1) !== 32) return null;
  return {
    start: Number(s.slice(start, p)),
    text: trimSlice(s, p + 2, end),
  };
}

function renderMarkdown(src, env) {
  const len = src.length;
  const ids = new Set();
  const toc = [];
  let html = '';
  let excerpt = null;
  let pos = 0;

  while (pos <= len) {
    let nl = src.indexOf('\n', pos);
    let end = nl === -1 ? len : nl;

    if (isBlankSlice(src, pos, end)) {
      if (nl === -1) break;
      pos = nl + 1;
      continue;
    }

    const c0 = src.charCodeAt(pos);

    if (c0 === 96) { // '`'
      const fenceLang = matchFenceOpen(src, pos, end);
      if (fenceLang !== null) {
        const cls = fenceLang === '' ? '' : ` class="language-${escapeHtml(fenceLang)}"`;
        html += `<pre><code${cls}>`;
        pos = nl === -1 ? len + 1 : nl + 1;
        while (pos <= len) {
          nl = src.indexOf('\n', pos);
          end = nl === -1 ? len : nl;
          if (isFenceClose(src, pos, end)) {
            pos = nl === -1 ? len + 1 : nl + 1;
            break;
          }
          html += `${escapeHtml(src.slice(pos, end))}\n`;
          if (nl === -1) {
            pos = len + 1;
            break;
          }
          pos = nl + 1;
        }
        html += '</code></pre>\n';
        continue;
      }
    }

    if (c0 === 35) { // '#'
      const heading = matchHeading(src, pos, end);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        const hHtml = inline(heading.text, env);
        html += `<h${heading.depth} id="${id}">${hHtml}</h${heading.depth}>\n`;
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html: hHtml });
        if (nl === -1) break;
        pos = nl + 1;
        continue;
      }
    }

    if ((c0 === 45 || c0 === 42) && isHr(src, pos, end)) {
      html += '<hr>\n';
      if (nl === -1) break;
      pos = nl + 1;
      continue;
    }

    if (c0 === 62) { // '>'
      let qText = '';
      while (pos <= len) {
        nl = src.indexOf('\n', pos);
        end = nl === -1 ? len : nl;
        if (src.charCodeAt(pos) !== 62) break;
        let qStart = pos + 1;
        if (qStart < end && src.charCodeAt(qStart) === 32) qStart++;
        const trimmed = trimSlice(src, qStart, end);
        if (trimmed !== '') qText = qText === '' ? trimmed : `${qText}\n${trimmed}`;
        if (nl === -1) {
          pos = len + 1;
          break;
        }
        pos = nl + 1;
      }
      if (qText === '') html += '<blockquote>\n</blockquote>\n';
      else html += `<blockquote>\n<p>${inline(qText, env)}</p>\n</blockquote>\n`;
      continue;
    }

    const bullet = (c0 === 45 || c0 === 42) ? matchBullet(src, pos, end) : null;
    const ordered = bullet === null && c0 >= 48 && c0 <= 57 ? matchOrdered(src, pos, end) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && ordered.start !== 1 ? `<ol start="${ordered.start}">` : `<${tag}>`;
      html += `${open}\n`;
      let curItem = isOrdered ? ordered.text : bullet;
      pos = nl === -1 ? len + 1 : nl + 1;
      while (pos <= len) {
        nl = src.indexOf('\n', pos);
        end = nl === -1 ? len : nl;
        const nextItem = isOrdered ? matchOrdered(src, pos, end) : matchBullet(src, pos, end);
        if (nextItem !== null) {
          html += `<li>${inline(curItem, env)}</li>\n`;
          curItem = isOrdered ? nextItem.text : nextItem;
          pos = nl === -1 ? len + 1 : nl + 1;
        } else if (isContinued(src, pos, end)) {
          curItem += `\n${trimSlice(src, pos, end)}`;
          pos = nl === -1 ? len + 1 : nl + 1;
        } else {
          break;
        }
      }
      html += `<li>${inline(curItem, env)}</li>\n</${tag}>\n`;
      continue;
    }

    // Paragraph
    let pText = trimSlice(src, pos, end);
    pos = nl === -1 ? len + 1 : nl + 1;
    while (pos <= len) {
      nl = src.indexOf('\n', pos);
      end = nl === -1 ? len : nl;
      if (isBlankSlice(src, pos, end)) break;
      const nc = src.charCodeAt(pos);
      if (nc === 96 && matchFenceOpen(src, pos, end) !== null) break;
      if (nc === 35 && matchHeading(src, pos, end) !== null) break;
      if ((nc === 45 || nc === 42) && isHr(src, pos, end)) break;
      pText += `\n${trimSlice(src, pos, end)}`;
      pos = nl === -1 ? len + 1 : nl + 1;
    }
    const pHtml = inline(pText, env);
    if (excerpt === null) excerpt = pHtml;
    html += `<p>${pHtml}</p>\n`;
  }

  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

const T_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const T_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const T_IF = /^if (not )?(\S+)$/;
const T_INCLUDE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!T_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenizeTemplate(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = isBlankSlice(src, lineStart, open) && isBlankSlice(src, end, lineEnd);
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplateAst(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenizeTemplate(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = T_FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = T_IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = T_INCLUDE.exec(tag)) !== null) {
        body.push({ kind: 'include', name: m[1] });
      } else {
        throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
      }
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function lookup1(scope, k0) {
  if (Object.hasOwn(scope.vars, k0)) return scope.vars[k0];
  let s = scope.parent;
  while (s !== null) {
    if (Object.hasOwn(s.vars, k0)) return s.vars[k0];
    s = s.parent;
  }
  return undefined;
}

function lookup2(scope, k0, k1) {
  let s = scope;
  if (!Object.hasOwn(s.vars, k0)) {
    s = s.parent;
    while (s !== null && !Object.hasOwn(s.vars, k0)) s = s.parent;
    if (s === null) return undefined;
  }
  const v = s.vars[k0];
  return v !== null && typeof v === 'object' ? v[k1] : undefined;
}

function lookup2Safe(scope, k0, k1) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, k0)) s = s.parent;
  if (s === null) return undefined;
  const v = s.vars[k0];
  if (v === null || typeof v !== 'object' || !Object.hasOwn(v, k1)) return undefined;
  return v[k1];
}

function lookupN(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function emitLookup(path, paths, scopeVar) {
  if (path.length === 1) return `lookup1(${scopeVar}, ${JSON.stringify(path[0])})`;
  if (path.length === 2) {
    const fn = path[1] in Object.prototype ? 'lookup2Safe' : 'lookup2';
    return `${fn}(${scopeVar}, ${JSON.stringify(path[0])}, ${JSON.stringify(path[1])})`;
  }
  const idx = paths.length;
  paths.push(path);
  return `lookupN(${scopeVar}, paths[${idx}])`;
}

function compileNodes(nodes, paths, code, scopeVar) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    switch (n.kind) {
      case 'text':
        code.push(`out += ${JSON.stringify(n.text)};`);
        break;
      case 'var':
      case 'raw': {
        const expr = emitLookup(n.path, paths, scopeVar);
        const txt = `textOf(${expr})`;
        code.push(n.kind === 'var' ? `out += escapeHtml(${txt});` : `out += ${txt};`);
        break;
      }
      case 'if': {
        const expr = emitLookup(n.path, paths, scopeVar);
        code.push(`if (${n.not ? '!' : ''}truthy(${expr})) {`);
        compileNodes(n.then, paths, code, scopeVar);
        if (n.else !== null) {
          code.push('} else {');
          compileNodes(n.else, paths, code, scopeVar);
        }
        code.push('}');
        break;
      }
      case 'for': {
        const id = code.length;
        const arrVar = `xs_${id}`;
        const childVar = `cs_${id}`;
        const loopVar = `lp_${id}`;
        const kVar = `k_${id}`;
        const lenVar = `l_${id}`;
        const expr = emitLookup(n.path, paths, scopeVar);
        code.push(`{ const ${arrVar} = ${expr}; if (Array.isArray(${arrVar})) { const ${lenVar} = ${arrVar}.length; const ${loopVar} = { index: 0, first: false, last: false, length: ${lenVar} }; const ${childVar} = { vars: { ${JSON.stringify(n.name)}: undefined, loop: ${loopVar} }, parent: ${scopeVar} }; for (let ${kVar} = 0; ${kVar} < ${lenVar}; ${kVar}++) { ${childVar}.vars[${JSON.stringify(n.name)}] = ${arrVar}[${kVar}]; ${loopVar}.index = ${kVar} + 1; ${loopVar}.first = ${kVar} === 0; ${loopVar}.last = ${kVar} === ${lenVar} - 1;`);
        compileNodes(n.body, paths, code, childVar);
        code.push('} } }');
        break;
      }
      case 'include':
        code.push(`{ const fn = templates.get(${JSON.stringify(n.name)}); if (fn !== undefined && depth < ${INCLUDE_DEPTH}) out += fn(${scopeVar}, templates, depth + 1); }`);
        break;
    }
  }
}

function compileTemplate(name, src) {
  const ast = parseTemplateAst(name, src);
  const paths = [];
  const code = ['let out = "";'];
  compileNodes(ast, paths, code, 'scope');
  code.push('return out;');
  const factory = new Function(
    'lookup1', 'lookup2', 'lookup2Safe', 'lookupN', 'textOf', 'truthy', 'escapeHtml', 'paths',
    `return function(scope, templates, depth) {\n${code.join('\n')}\n};`,
  );
  return factory(lookup1, lookup2, lookup2Safe, lookupN, textOf, truthy, escapeHtml, paths);
}

// ---------------------------------------------------------------- pipeline

function dirOf(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function resolvePath(dir, rel) {
  if (rel.indexOf('..') === -1 && rel.indexOf('./') === -1 && rel.indexOf('//') === -1 && rel.charCodeAt(0) !== 47 && rel.charCodeAt(rel.length - 1) !== 47 && rel !== '.') {
    return dir === '' ? rel : `${dir}/${rel}`;
  }
  if (dir !== '' && dir.indexOf('/') === -1 && rel.startsWith('../') && rel.indexOf('..', 3) === -1 && rel.indexOf('./', 3) === -1 && rel.indexOf('//', 3) === -1 && rel.charCodeAt(rel.length - 1) !== 47 && rel.length > 3) {
    return rel.slice(3);
  }
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function run(input) {
  const templates = new Map();
  const report = [];
  const tplNames = Object.keys(input.templates).sort(byCodeUnits);
  for (let i = 0; i < tplNames.length; i++) {
    const name = tplNames[i];
    try {
      templates.set(name, compileTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));

  const sources = [];
  const statics = [];
  const staticPaths = new Set();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.path.endsWith('.md')) {
      const content = f.content;
      const text = content.indexOf('\r') === -1 ? content : content.replace(/\r\n?/g, '\n');
      sources.push({ path: f.path, text });
    } else {
      statics.push(f);
      staticPaths.add(f.path);
    }
  }

  // 2. Front matter
  const kept = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    s.dateLong = s.data.date === undefined ? '' : longDate(s.data.date);
    kept.push(s);
  }

  // 3. Permalinks
  const taken = new Map();
  const bySource = new Map();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : undefined);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Markdown
  const broken = new Set();
  let curDir = '';
  let curPath = '';
  const env = {
    link(target) {
      const c0 = target.charCodeAt(0);
      if (c0 === 47 || c0 === 35 || HAS_SCHEME.test(target)) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(curDir, rel);
      if (path !== null) {
        const targetSource = bySource.get(path);
        if (targetSource !== undefined) return `${targetSource.url}${frag}`;
        if (staticPaths.has(path)) return `${base}/${path}${frag}`;
      }
      broken.add(`broken-link ${curPath} -> ${target}`);
      return target;
    },
  };

  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    curPath = s.path;
    curDir = dirOf(s.path);
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. Collections
  const posts = [];
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].post) posts.push(kept[i]);
  }
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    const p = posts[k];
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 6. Tags
  const bySlug = new Map();
  const slugCache = new Map();
  const getSlug = (name) => {
    let s = slugCache.get(name);
    if (s === undefined) {
      s = slugify(name);
      slugCache.set(name, s);
    }
    return s;
  };

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const rawTags = p.data.tags;
    if (rawTags === undefined || rawTags.length === 0) {
      p.tagRefs = [];
      continue;
    }
    const seen = new Set();
    const refs = [];
    for (let j = 0; j < rawTags.length; j++) {
      const name = rawTags[j];
      const slug = getSlug(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        const url = `${base}/tags/${slug}/`;
        tag = { name, slug, url, posts: [], ref: { name, slug, url } };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      refs.push(tag.ref);
    }
    p.tagRefs = refs;
  }

  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    if (s.post) continue;
    const rawTags = s.data.tags;
    if (rawTags === undefined || rawTags.length === 0) {
      s.tagRefs = [];
      continue;
    }
    const seen = new Set();
    const refs = [];
    for (let j = 0; j < rawTags.length; j++) {
      const name = rawTags[j];
      const slug = getSlug(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const tag = bySlug.get(slug);
      refs.push(tag !== undefined ? tag.ref : { name, slug, url: '' });
    }
    s.tagRefs = refs;
  }

  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Layouts
  const cards = new Map();
  const buildCard = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.dateLong,
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs,
  });

  for (let i = 0; i < posts.length; i++) {
    cards.set(posts[i], buildCard(posts[i]));
  }

  const site = { title: input.site.title, base_url: base };
  const allTags = new Array(tags.length);
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    allTags[i] = { name: t.name, slug: t.slug, url: t.url, count: t.posts.length };
  }
  const recentCount = Math.min(input.site.recent, posts.length);
  const recent = new Array(recentCount);
  for (let i = 0; i < recentCount; i++) recent[i] = cards.get(posts[i]);

  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.dateLong });

  const output = {};
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const fn = templates.get(s.layout);
    if (fn === undefined) {
      output[`${s.outDir}/index.html`] = null;
      continue;
    }
    const card = s.post ? cards.get(s) : buildCard(s);
    const page = {
      ...card,
      slug: s.slug,
      content: s.html,
      toc: s.toc,
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[`${s.outDir}/index.html`] = fn({ vars: { site, tags: allTags, recent, page }, parent: null }, templates, 0);
  }

  const indexFn = templates.get('index');
  if (indexFn !== undefined) {
    const per = input.site.per_page;
    const totalPages = Math.max(1, Math.ceil(posts.length / per));
    const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
    for (let k = 1; k <= totalPages; k++) {
      const start = (k - 1) * per;
      const end = Math.min(posts.length, k * per);
      const pagePosts = new Array(end - start);
      for (let j = start; j < end; j++) pagePosts[j - start] = cards.get(posts[j]);
      const pager = {
        number: k,
        total: totalPages,
        url: indexUrl(k),
        newer_url: k === 1 ? '' : indexUrl(k - 1),
        older_url: k === totalPages ? '' : indexUrl(k + 1),
      };
      output[k === 1 ? 'index.html' : `page/${k}/index.html`] = indexFn(
        { vars: { site, tags: allTags, recent, posts: pagePosts, pager }, parent: null },
        templates,
        0,
      );
    }
  }

  const tagFn = templates.get('tag');
  if (tagFn !== undefined) {
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      const tagPosts = new Array(t.posts.length);
      for (let j = 0; j < t.posts.length; j++) tagPosts[j] = cards.get(t.posts[j]);
      const tagObj = { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: tagPosts };
      output[`tags/${t.slug}/index.html`] = tagFn(
        { vars: { site, tags: allTags, recent, tag: tagObj }, parent: null },
        templates,
        0,
      );
    }
  }

  const tagsFn = templates.get('tags');
  if (tagsFn !== undefined) {
    output['tags/index.html'] = tagsFn({ vars: { site, tags: allTags, recent }, parent: null }, templates, 0);
  }

  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. Report
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.length - posts.length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;

  return output;
}
