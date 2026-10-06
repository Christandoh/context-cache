// Advance widths (per 1000 em) of Arial / Helvetica-compatible metrics
// (Liberation Sans), for laying out SVG text the way the browser lays out
// the design's "Helvetica Neue", Helvetica, Arial stack. Generated.

const CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~·●—…◆–'
const REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 333, 604, 1000, 1000, 600, 556]
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 333, 604, 1000, 1000, 600, 556]

const reg = new Map<string, number>()
const bold = new Map<string, number>()
for (let i = 0; i < CHARS.length; i++) {
  reg.set(CHARS[i]!, REGULAR[i]!)
  bold.set(CHARS[i]!, BOLD[i]!)
}

/** Width in px of `text` at `size` px, regular or bold. */
export function textWidth(text: string, size: number, isBold = false): number {
  const table = isBold ? bold : reg
  let units = 0
  for (const ch of text) units += table.get(ch) ?? 556
  return (units / 1000) * size
}

/** `text` cut to fit `max` px, with an ellipsis, as CSS text-overflow does. */
export function ellipsize(text: string, size: number, max: number, isBold = false): string {
  if (textWidth(text, size, isBold) <= max) return text
  const ell = '…'
  let out = ''
  for (const ch of text) {
    if (textWidth(out + ch + ell, size, isBold) > max) break
    out += ch
  }
  return out.replace(/\s+$/, '') + ell
}
