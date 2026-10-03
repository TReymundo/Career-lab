import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Tab, TabStopType, TextRun } from 'docx';
import PDFDocument from 'pdfkit';

/**
 * Turns the generators' Markdown into files you can actually upload.
 *
 * DOCX first: most graduate application forms parse Word more reliably than PDF, and a
 * recruiter can open it without a converter. PDF second, for portals that demand it and for
 * anything you email directly.
 *
 * Both draw the classic one-column CV the screen shows (src/index.css, .cv-page): serif type,
 * centred name and contact line, a rule under each heading, places and dates right-aligned.
 * The layout lines they understand are the ones buildCV writes — see src/lib/markdown.ts.
 */

interface Run { text: string; bold?: boolean; italic?: boolean }

type Block =
  | { type: 'h1' | 'h2' | 'p' | 'li' | 'center' | 'quote'; runs: Run[] }
  | { type: 'rule' }
  | { type: 'row'; entry: boolean; left: Run[]; right: Run[] };

/** Inline **bold** / *italic*, with links flattened to their label. */
function parseInline(text: string): Run[] {
  const clean = text.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1');
  const runs: Run[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    if (m.index > last) runs.push({ text: clean.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2], italic: true });
    last = m.index + m[0].length;
  }
  if (last < clean.length) runs.push({ text: clean.slice(last) });
  return runs.length ? runs : [{ text: clean }];
}

const rowOf = (s: string, entry: boolean): Block => {
  const [left, right = ''] = s.split(' || ');
  return { type: 'row', entry, left: left.trim() ? parseInline(left) : [], right: right.trim() ? parseInline(right) : [] };
};

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('## ')) blocks.push({ type: 'h2', runs: parseInline(line.slice(3)) });
    else if (line.startsWith('### ')) blocks.push(rowOf(line.slice(4), true));
    else if (line.startsWith('# ')) blocks.push({ type: 'h1', runs: parseInline(line.slice(2)) });
    else if (line.startsWith('^ ')) blocks.push({ type: 'center', runs: parseInline(line.slice(2)) });
    else if (line === '---') blocks.push({ type: 'rule' });
    else if (line.startsWith('> ')) blocks.push({ type: 'quote', runs: parseInline(line.slice(2)) });
    else if (/^[-*] /.test(line)) blocks.push({ type: 'li', runs: parseInline(line.slice(2)) });
    else if (line.includes(' || ')) blocks.push(rowOf(line, false));
    else blocks.push({ type: 'p', runs: parseInline(line) });
  }
  return blocks;
}

/* ------------------------------------------------------------------ Word */

const FONT = 'Times New Roman'; // the same face as the PDF (Times) and the on-screen page
const A4 = { width: 11906, height: 16838 };
const MARGIN = 850;
const TEXT_WIDTH = A4.width - MARGIN * 2;

export async function toDocx(md: string): Promise<Buffer> {
  const blocks = parseMarkdown(md);
  const tr = (r: Run, extra: { italics?: boolean; size?: number; bold?: boolean } = {}) =>
    new TextRun({ text: r.text, bold: extra.bold ?? r.bold, italics: extra.italics || r.italic, size: extra.size, font: FONT });

  const children = blocks.map((b, i) => {
    switch (b.type) {
      case 'h1':
        return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: b.runs.map((r) => tr(r, { bold: true, size: 44 })) });
      case 'center':
        return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: b.runs.map((r) => tr(r)) });
      case 'rule':
        return new Paragraph({ spacing: { after: 140 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '222222', space: 1 } }, children: [] });
      case 'quote':
        return new Paragraph({ spacing: { after: 60 }, children: b.runs.map((r) => tr(r, { italics: true })) });
      case 'h2':
        return new Paragraph({
          spacing: { before: 260, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '222222', space: 1 } },
          children: b.runs.map((r) => tr({ text: r.text.toUpperCase() }, { bold: true, size: 23 })),
        });
      case 'row':
        return new Paragraph({
          spacing: { before: b.entry && blocks[i - 1]?.type !== 'h2' ? 140 : 0, after: 0 },
          tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }],
          children: [...b.left.map((r) => tr(r)), ...(b.right.length ? [new TextRun({ children: [new Tab()] }), ...b.right.map((r) => tr(r))] : [])],
        });
      case 'li':
        return new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 }, children: b.runs.map((r) => tr(r)) });
      default:
        return new Paragraph({ spacing: { after: 80 }, children: b.runs.map((r) => tr(r)) });
    }
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{
      properties: { page: { size: A4, margin: { top: 800, bottom: 800, left: MARGIN, right: MARGIN } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

/* ------------------------------------------------------------------ PDF */

export function toPdf(md: string): Promise<Buffer> {
  const blocks = parseMarkdown(md);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 46, bottom: 46, left: 48, right: 48 } });
  const chunks: Buffer[] = [];
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const BODY = 10.5;

  const fontFor = (r: Run, base: 'roman' | 'italic' = 'roman') =>
    r.bold ? (r.italic || base === 'italic' ? 'Times-BoldItalic' : 'Times-Bold')
           : r.italic || base === 'italic' ? 'Times-Italic' : 'Times-Roman';

  /** Writes a run of mixed styles as one flowing paragraph. */
  const write = (runs: Run[], x: number, w: number, opts: { size?: number; align?: 'left' | 'center' | 'right'; base?: 'roman' | 'italic'; wrap?: boolean } = {}) => {
    doc.fontSize(opts.size ?? BODY).fillColor('#111111');
    runs.forEach((r, i) => {
      doc.font(fontFor(r, opts.base));
      doc.text(r.text, i === 0 ? x : undefined, i === 0 ? doc.y : undefined, {
        continued: i < runs.length - 1, width: w, align: opts.align ?? 'left', lineGap: 1.5, lineBreak: opts.wrap ?? true,
      });
    });
  };

  const rule = (gapAfter: number) => {
    const y = doc.y + 1;
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#222222').lineWidth(0.7).stroke();
    doc.y = y + gapAfter;
  };

  return new Promise((resolveBuf, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolveBuf(Buffer.concat(chunks)));
    doc.on('error', reject);

    blocks.forEach((b, i) => {
      switch (b.type) {
        case 'h1': write(b.runs.map((r) => ({ ...r, bold: true })), left, width, { size: 21, align: 'center' }); doc.moveDown(0.15); break;
        case 'center': write(b.runs, left, width, { align: 'center' }); break;
        case 'rule': doc.moveDown(0.2); rule(8); break;
        case 'quote': write(b.runs, left, width, { base: 'italic' }); doc.moveDown(0.2); break;
        case 'h2':
          doc.moveDown(0.7);
          write(b.runs.map((r) => ({ text: r.text.toUpperCase(), bold: true })), left, width, { size: 11.5 });
          rule(6);
          break;
        case 'row': {
          if (b.entry && blocks[i - 1]?.type !== 'h2') doc.moveDown(0.45);
          const top = doc.y;
          // Right part first, so the left part knows how much room it has.
          let rightW = 0;
          if (b.right.length) {
            doc.fontSize(BODY);
            // Measured, plus a little slack: the right column is one line and must never wrap.
            rightW = b.right.reduce((n, r) => n + doc.font(fontFor(r)).widthOfString(r.text), 0) + 4;
            write(b.right, left + width - rightW, rightW, { align: 'right', wrap: false });
            doc.y = top + doc.currentLineHeight(true);
          }
          const rightBottom = doc.y;
          doc.y = top;
          if (b.left.length) write(b.left, left, width - rightW - 14);
          doc.y = Math.max(doc.y, rightBottom);
          break;
        }
        case 'li':
          doc.fontSize(BODY).font('Times-Roman').text('•', left + 12, doc.y, { lineBreak: false });
          write(b.runs, left + 26, width - 26);
          doc.moveDown(0.1);
          break;
        default: write(b.runs, left, width); doc.moveDown(0.25);
      }
    });
    doc.end();
  });
}


/** `Perez_Tomas_CV_AcmeCorp.pdf` — a recruiter's download folder should say who you are. */
/** Pérez → Perez. Filenames travel through systems that mangle accents, names should not. */
const deaccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/gi, (m) => (m === 'ñ' ? 'n' : 'N'));

export function fileName(opts: { name: string; kind: string; company?: string; lang: string; ext: string }) {
  const parts = deaccent(opts.name).trim().split(/\s+/).filter(Boolean);
  const person = parts.length > 1 ? `${parts.at(-1)}_${parts[0]}` : (parts[0] ?? 'CV');
  const kindLabel = { cv: 'CV', cover: 'CoverLetter', outreach: 'Outreach', prep: 'InterviewPrep', plan: 'TailoringPlan', debrief: 'Debrief' }[opts.kind] ?? opts.kind;
  const company = deaccent(opts.company ?? '').replace(/[^A-Za-z0-9]+/g, '');
  return [person, kindLabel, company, opts.lang.toUpperCase()]
    .filter(Boolean)
    .join('_')
    .replace(/[^A-Za-z0-9_]/g, '') + `.${opts.ext}`;
}
