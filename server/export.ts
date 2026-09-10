import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';

/**
 * Turns the generators' Markdown into files you can actually upload.
 *
 * DOCX first: most graduate application forms parse Word more reliably than PDF, and a
 * recruiter can open it without a converter. PDF second, for portals that demand it and for
 * anything you email directly.
 */

type Block =
  | { type: 'h1' | 'h2' | 'p'; runs: Run[] }
  | { type: 'li'; runs: Run[] };

interface Run { text: string; bold?: boolean; italic?: boolean }

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

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('## ')) blocks.push({ type: 'h2', runs: parseInline(line.slice(3)) });
    else if (line.startsWith('# ')) blocks.push({ type: 'h1', runs: parseInline(line.slice(2)) });
    else if (/^[-*] /.test(line)) blocks.push({ type: 'li', runs: parseInline(line.slice(2)) });
    else blocks.push({ type: 'p', runs: parseInline(line) });
  }
  return blocks;
}

const FONT = 'Calibri';

export async function toDocx(md: string): Promise<Buffer> {
  const blocks = parseMarkdown(md);

  const children = blocks.map((b) => {
    const runs = b.runs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, font: FONT }));

    if (b.type === 'h1') {
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: b.runs.map((r) => new TextRun({ text: r.text, bold: true, size: 32, font: FONT })),
      });
    }
    if (b.type === 'h2') {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 260, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 2 } },
        children: b.runs.map((r) => new TextRun({ text: r.text.toUpperCase(), bold: true, size: 20, font: FONT, color: '1F8C58' })),
      });
    }
    if (b.type === 'li') {
      return new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: runs });
    }
    return new Paragraph({ spacing: { after: 80 }, children: runs });
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 850, right: 850 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

export function toPdf(md: string): Promise<Buffer> {
  const blocks = parseMarkdown(md);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 52, right: 52 } });
  const chunks: Buffer[] = [];

  return new Promise((resolveBuf, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolveBuf(Buffer.concat(chunks)));
    doc.on('error', reject);

    const write = (runs: Run[], opts: { size: number; gap: number; indent?: number; color?: string; bullet?: boolean; align?: 'center' | 'left' }) => {
      doc.fontSize(opts.size).fillColor(opts.color ?? '#111111');
      const x = doc.page.margins.left + (opts.indent ?? 0);
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right - (opts.indent ?? 0);
      if (opts.bullet) {
        doc.font('Helvetica').text('•', doc.page.margins.left + 4, doc.y, { continued: false, lineBreak: false });
      }
      runs.forEach((r, i) => {
        doc.font(r.bold ? 'Helvetica-Bold' : r.italic ? 'Helvetica-Oblique' : 'Helvetica');
        doc.text(r.text, i === 0 ? x : undefined, i === 0 ? doc.y : undefined, {
          continued: i < runs.length - 1,
          width,
          align: opts.align ?? 'left',
        });
      });
      doc.moveDown(opts.gap);
    };

    for (const b of blocks) {
      if (b.type === 'h1') write(b.runs.map((r) => ({ ...r, bold: true })), { size: 19, gap: 0.25, align: 'center' });
      else if (b.type === 'h2') {
        doc.moveDown(0.5);
        write(b.runs.map((r) => ({ text: r.text.toUpperCase(), bold: true })), { size: 10.5, gap: 0.15, color: '#1F8C58' });
        const y = doc.y;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
          .strokeColor('#D5DFD8').lineWidth(0.6).stroke();
        doc.moveDown(0.35);
      }
      else if (b.type === 'li') write(b.runs, { size: 10, gap: 0.2, indent: 14, bullet: true });
      else write(b.runs, { size: 10, gap: 0.3 });
    }
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
