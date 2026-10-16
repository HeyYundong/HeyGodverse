#!/usr/bin/env node
// 把 神话/*.md 和 译本/<语言>/*.md 编进 index.html 里的阅读器数据（<script id="book-data">）。
// 用法：node tools/build.mjs
//
// - 只收世界内的文字：题记、正文各节、异文。【幕后】、画面、金句只给作者看，不进阅读器。
// - 译本按文件编号（001、002……）对应原文，每一节的段落数必须和原文一致：
//   阅读器靠段落序号在语言之间保持阅读位置，也靠它决定皮影换幕的时机。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = { zh: '神话', en: '译本/en', ar: '译本/ar' };
const AUTHOR_ONLY = /^(【幕后】|幕后|画面|金句)$/;
const QUOTE_ONLY = /^[“"«「][^“”"«»「」]{1,22}[”"»」]$/u;

function parse(md, lang) {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const myth = { title: '', epigraph: '', chapters: [] };
  const glue = lang === 'zh' ? '' : ' ';
  let ch = null, skipping = false, buf = [];
  const flush = () => {
    const text = buf.join(glue).trim();
    buf = [];
    if (text && ch && !skipping) ch.blocks.push(block(text));
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#\s/.test(line)) { flush(); myth.title = line.slice(2).trim(); continue; }
    if (/^##\s/.test(line)) {
      flush();
      const h = line.slice(3).trim();
      skipping = AUTHOR_ONLY.test(h);
      if (!skipping) {
        const parts = h.split(/\s+·\s+/);
        ch = parts.length > 1 ? { label: parts[0], title: parts.slice(1).join(' · '), blocks: [] } : { label: '', title: h, blocks: [] };
        myth.chapters.push(ch);
      }
      continue;
    }
    if (!ch && /^>/.test(line)) { myth.epigraph += line.replace(/^>\s?/, ''); continue; }
    if (!line || /^-{3,}$/.test(line)) { flush(); continue; }
    if (/^[-*]\s+/.test(line)) { flush(); buf.push(line); flush(); continue; }
    buf.push(line);
  }
  flush();
  return myth;
}

function block(text) {
  const plain = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2');
  if (/^[-*]\s+/.test(text)) return { t: 'li', text: plain(text.replace(/^[-*]\s+/, '')) };
  const strong = text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  if (strong) return { t: 'h', text: strong[1], note: plain(strong[2]) };
  const p = plain(text);
  return QUOTE_ONLY.test(p) ? { t: 'q', text: p } : { t: 'p', text: p };
}

function load(lang) {
  const dir = join(ROOT, SOURCES[lang]);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /^\d{3}-.+\.md$/.test(f))
    .sort()
    .map(f => ({ id: f.slice(0, 3), file: `${SOURCES[lang]}/${f}`, ...parse(readFileSync(join(dir, f), 'utf8'), lang) }));
}

const zh = load('zh');
const out = { langs: { zh: { myths: zh } } };
const problems = [];
for (const lang of Object.keys(SOURCES).filter(l => l !== 'zh')) {
  const myths = load(lang);
  if (!myths.length) continue;
  const byId = new Map(myths.map(m => [m.id, m]));
  const aligned = [];
  for (const src of zh) {
    const tr = byId.get(src.id);
    if (!tr) { problems.push(`${lang}: 缺少 ${src.id}（${src.title}）的译本，该语言暂不显示这一篇`); continue; }
    let ok = tr.chapters.length === src.chapters.length;
    if (!ok) problems.push(`${tr.file}: 有 ${tr.chapters.length} 节，原文有 ${src.chapters.length} 节`);
    src.chapters.forEach((c, i) => {
      const t = tr.chapters[i];
      if (!t) return;
      const a = c.blocks.map(b => b.t).join(''), b = t.blocks.map(x => x.t).join('');
      if (a !== b) { ok = false; problems.push(`${tr.file} 第 ${i + 1} 节「${t.title}」: 段落结构 ${b.length} 段（${b}），原文 ${a.length} 段（${a}）`); }
    });
    if (ok) aligned.push(tr);
  }
  if (aligned.length === zh.length) out.langs[lang] = { myths: aligned };
  else problems.push(`${lang}: 译本未完全对齐，暂不在阅读器里显示`);
}

const html = join(ROOT, 'index.html');
const page = readFileSync(html, 'utf8');
const re = /(<script id="book-data" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!re.test(page)) { console.error('index.html 里找不到 <script id="book-data" type="application/json">'); process.exit(1); }
const json = JSON.stringify(out).replace(/</g, '\\u003c');
writeFileSync(html, page.replace(re, (_, a, b) => `${a}${json}${b}`));

for (const [lang, { myths }] of Object.entries(out.langs)) {
  const n = myths.reduce((s, m) => s + m.chapters.reduce((t, c) => t + c.blocks.length, 0), 0);
  console.log(`${lang}: ${myths.length} 篇，${myths.reduce((s, m) => s + m.chapters.length, 0)} 节，${n} 段`);
}
if (problems.length) { console.warn('\n注意：\n- ' + problems.join('\n- ')); process.exitCode = 2; }
