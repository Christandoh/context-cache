// The desktop/mobile panel drawn as SVG at the design's exact pixel sizes.
//
// The host's Text has no font size, so every line of the design (13px titles,
// 12.5px labels, 11.5px detail, 10.5px ring captions) is laid out here with
// the design's own font stack and Arial-compatible metrics, positioned the
// way the browser positions the design's HTML (line-height normal, flex gaps,
// ellipsis). The host draws the card, and its own buttons for the actions.

import { ellipsize, textWidth } from './metrics'
import { CACHE_COLORS, fmtTokens, pct, TOKENS, type CacheView, type LimitView, type ViewModel } from './model'

const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`
// Arial / Helvetica vertical metrics per em. Chrome rounds each to whole
// pixels before stacking them into a line box, so this does too.
const ASC = 0.905
const DESC = 0.212
const GAP = 0.0327
const A = (size: number) => Math.round(ASC * size)
const D = (size: number) => Math.round(DESC * size)
const TICK = 'rgba(236,233,226,.85)'
const NS = 'http://www.w3.org/2000/svg'

/** The design's four widths: a ≈ 900px, b ≈ 620px (columns from ~500px), c ≈ 420px (rings), d ≈ 320px (no legend). */
export type DesignSize = ViewModel['size']

const PAD: Record<DesignSize, { y: number; x: number }> = {
  a: { y: 14, x: 18 },
  b: { y: 11, x: 14 },
  c: { y: 11, x: 14 },
  d: { y: 10, x: 12 },
}
const ROW_GAP = 11
/** A design button: 12.5px text, 6px padding, a 1px border on Compact. */
export const BUTTON_H = lhOf(12.5) + 12 + 2

function lhOf(size: number): number {
  return A(size) + D(size) + Math.round(GAP * size)
}

const lh = lhOf
/** Baseline of a line box of height `box` (default: line-height normal) with its top at `top`. */
const baseline = (top: number, size: number, box = lhOf(size)) => top + (box - A(size) - D(size)) / 2 + A(size)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const r2 = (n: number) => Math.round(n * 100) / 100

type Run = { text: string; color: string; bold?: boolean }

/** One line of runs starting at x, its line box's top at `top`. */
function line(x: number, top: number, size: number, runs: Run[], anchor: 'start' | 'end' = 'start', clipId?: string): string {
  const y = r2(baseline(top, size))
  const spans = runs
    .map(r => `<tspan fill="${r.color}"${r.bold ? ' font-weight="700"' : ''}>${esc(r.text)}</tspan>`)
    .join('')
  const clip = clipId ? ` clip-path="url(#${clipId})"` : ''
  return `<text x="${r2(x)}" y="${y}" font-size="${size}" text-anchor="${anchor}"${clip} xml:space="preserve">${spans}</text>`
}

function runsWidth(runs: Run[], size: number): number {
  return runs.reduce((w, r) => w + textWidth(r.text, size, r.bold), 0)
}

/** Cuts a run list to `max` px with an ellipsis on the run that overflows. */
function fitRuns(runs: Run[], size: number, max: number): Run[] {
  if (runsWidth(runs, size) <= max) return runs
  const out: Run[] = []
  let used = 0
  for (const r of runs) {
    const w = textWidth(r.text, size, r.bold)
    if (used + w <= max - textWidth('…', size, r.bold)) {
      out.push(r)
      used += w
      continue
    }
    out.push({ ...r, text: ellipsize(r.text, size, max - used, r.bold) })
    break
  }
  return out
}

/** A rounded 8px bar track, clipped, with whatever is drawn inside. */
function bar(id: string, x: number, y: number, w: number, inner: string, track: string = TOKENS.track): string {
  return (
    `<clipPath id="${id}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(Math.max(0, w))}" height="8" rx="4"/></clipPath>` +
    `<g clip-path="url(#${id})"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(Math.max(0, w))}" height="8" fill="${track}"/>${inner}</g>`
  )
}

function tick(x: number, y: number): string {
  return `<rect x="${r2(x)}" y="${r2(y)}" width="2" height="8" fill="${TICK}"/>`
}

/** Context: segments as flex children with 1px gaps; the auto-compact tick. */
function contextBar(id: string, ctx: NonNullable<ViewModel['context']>, x: number, y: number, w: number): string {
  let inner = ''
  let at = x
  for (const s of ctx.segments) {
    const sw = (s.tokens / ctx.window) * w
    if (s.tokens > 0) inner += `<rect x="${r2(at)}" y="${r2(y)}" width="${r2(sw)}" height="8" fill="${s.color}"/>`
    at += sw + 1
  }
  if (ctx.compactPct !== null) inner += tick(x + (ctx.compactPct / 100) * w, y)
  return bar(id, x, y, w, inner)
}

/** Limit: dark = time (to the larger of both), bright = usage, tick at time. */
function limitBar(id: string, l: LimitView, x: number, y: number, w: number): string {
  if (l.usage === null) return bar(id, x, y, w, '')
  const u = l.usage
  const t = l.time ?? 0
  const darkW = (Math.max(u, t) / 100) * w
  let inner = `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(darkW)}" height="8" fill="${l.dark}"/>`
  inner += `<rect x="${r2(x)}" y="${r2(y)}" width="${r2((u / 100) * w)}" height="8" fill="${l.bright}"/>`
  if (l.time !== null) inner += tick(x + (t / 100) * w, y)
  return bar(id, x, y, w, inner)
}

/** Cache: the temperature gradient, covered right of the warmth, tick at it. */
function tempBar(id: string, c: CacheView, x: number, y: number, w: number): string {
  const gid = `${id}g`
  const wx = x + c.warmth * w
  let inner =
    `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${r2(x)}" x2="${r2(x + w)}" y1="0" y2="0">` +
    `<stop offset="0" stop-color="${CACHE_COLORS.cold}"/><stop offset="0.5" stop-color="${CACHE_COLORS.cooling}"/>` +
    `<stop offset="1" stop-color="${CACHE_COLORS.warm}"/></linearGradient>` +
    `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="8" fill="url(#${gid})"/>` +
    `<rect x="${r2(wx)}" y="${r2(y)}" width="${r2(x + w - wx)}" height="8" fill="rgba(34,33,32,.74)"/>`
  if (c.state !== 'empty') inner += tick(wx, y)
  return bar(id, x, y, w, inner, 'transparent')
}

// ── Icons and rings ────────────────────────────────────────────────────────

type IconName = 'clock' | 'calendar' | 'fable' | 'flame' | 'snow' | 'empty'

/** 24-unit icons standing in for the design's text glyphs (5h, 7d, F, ◆). */
function icon(name: IconName, color: string): string {
  const s = `fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`
  switch (name) {
    case 'clock':
      return `<circle cx="12" cy="12" r="9" ${s}/><path d="M12 7v5l3.5 2" ${s}/>`
    case 'calendar':
      return `<rect x="3.5" y="5" width="17" height="15" rx="2.5" ${s}/><path d="M3.5 10h17M8.5 3v4M15.5 3v4" ${s}/>`
    case 'fable':
      return `<path d="M12 2.5l2.2 6.6 6.8 2.4-6.8 2.4L12 20.5l-2.2-6.6L3 11.5l6.8-2.4z" fill="${color}"/>`
    case 'flame':
      return `<path d="M12 2.5c.8 3.4 5 5.6 5 10.5a5 5 0 0 1-10 0c0-2.6 1.4-4 2.6-5.2.2 2 1 3.2 2.4 3.6-.6-3.2-.8-6.2 0-8.9z" fill="${color}"/>`
    case 'snow':
      return `<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8" ${s}/>`
    case 'empty':
      return `<circle cx="12" cy="12" r="7" ${s}/>`
  }
}

/** An arc of the 30px ring (centre radius 13, 4 wide) from deg a to deg b, clockwise from 12 o'clock. */
function arc(cx: number, cy: number, a: number, b: number, color: string): string {
  if (b - a <= 0) return ''
  if (b - a >= 359.99) return `<circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="${color}" stroke-width="4"/>`
  const p = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${r2(cx + 13 * Math.cos(rad))} ${r2(cy + 13 * Math.sin(rad))}`
  }
  const large = b - a > 180 ? 1 : 0
  return `<path d="M${p(a)} A13 13 0 ${large} 1 ${p(b)}" fill="none" stroke="${color}" stroke-width="4"/>`
}

/** The design's conic ring: bright = usage, dark to the larger of usage and time, a 4° notch at time. */
function ring(x: number, y: number, a: { usage: number | null; time: number | null; bright: string; dark: string; icon: IconName; iconColor: string }): string {
  const cx = x + 15
  const cy = y + 15
  let s = `<circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="${TOKENS.ringTrack}" stroke-width="4"/>`
  if (a.usage !== null) {
    const u = a.usage * 3.6
    const t = (a.time ?? 0) * 3.6
    s += arc(cx, cy, 0, Math.max(u, t), a.dark)
    s += arc(cx, cy, 0, u, a.bright)
    if (a.time !== null) s += arc(cx, cy, Math.max(0, t - 2), Math.min(360, t + 2), TICK)
  }
  s += `<circle cx="${cx}" cy="${cy}" r="11" fill="${TOKENS.card}"/>`
  s += `<g transform="translate(${cx - 6} ${cy - 6}) scale(0.5)">${icon(a.icon, a.iconColor)}</g>`
  return s
}

const LIMIT_ICON = { session: 'clock', weekly: 'calendar', fable: 'fable' } as const
const cacheIcon = (c: CacheView): IconName => (c.state === 'cold' ? 'snow' : c.state === 'empty' ? 'empty' : 'flame')

// ── The panel ──────────────────────────────────────────────────────────────

export type PanelSvg = {
  size: DesignSize
  /** What the whole panel says, for a reader that cannot see it. */
  alt: string
  /** Everything above the buttons: rows 1–3 (and, narrow, the notice text), padded as the card. */
  body: { svg: string; width: number; height: number }
  /** Wide layouts: the notice line beside the buttons. */
  notice: { svg: string; width: number; height: number } | null
  /** The width the host's buttons take on wide layouts, right padding included. */
  buttonsWidth: number
  /** Wide, but the notice is too long to sit beside the buttons: they wrap below it, left-aligned. */
  noticeWraps: boolean
  pad: { x: number; y: number }
}

function svgDoc(width: number, height: number, body: string, alt: string): string {
  return (
    `<svg xmlns="${NS}" width="${r2(width)}" height="${r2(height)}" viewBox="0 0 ${r2(width)} ${r2(height)}" ` +
    `font-family="${FONT}" role="img" aria-label="${esc(alt)}">${body}</svg>`
  )
}

/** Width of the design's three buttons (Warm or Stop, whichever is wider) and their gaps. */
function buttonsWidthOf(): number {
  const b = (label: string, padX: number, border: number) => textWidth(label, 12.5) + padX * 2 + border * 2
  return b('Clear', 12, 0) + b('Compact', 12, 1) + Math.max(b('Warm', 12, 1), b('Stop', 12, 1)) + 6 * 2
}

/**
 * Lays the panel out at `width` px (the card's inner width, border excluded)
 * in the view model's size class. Ids are prefixed so several panels can share a page.
 */
export function panelSvg(vm: ViewModel, width: number, idPrefix = 'cc'): PanelSvg {
  const size = vm.size
  const pad = PAD[size]
  const W = width
  const inner = W - pad.x * 2
  const wide = size === 'a' || size === 'b'
  let y = pad.y
  let out = ''
  let n = 0
  const id = () => `${idPrefix}${n++}`

  // Row 1: Context
  const ctx = vm.context
  const h1 = lh(13)
  if (ctx) {
    const right = ctx.compactPct === null ? `${pct((ctx.used / ctx.window) * 100)}%` : wide ? `Compact at ${ctx.compactPct}%` : `${ctx.compactPct}%`
    const cy = y + h1 / 2
    let x = pad.x
    out += line(x, cy - lh(13) / 2, 13, [{ text: 'Context', color: TOKENS.text, bold: true }])
    x += textWidth('Context', 13, true) + 10
    const used = ctx.usedLabel
    out += line(x, cy - lh(12.5) / 2, 12.5, [{ text: used, color: TOKENS.text3 }])
    x += textWidth(used, 12.5) + 10
    const rightX = W - pad.x
    out += line(rightX, cy - lh(12.5) / 2, 12.5, [{ text: right, color: TOKENS.text4 }], 'end')
    const barW = Math.max(40, rightX - textWidth(right, 12.5) - 10 - x)
    out += contextBar(id(), ctx, x, cy - 4, barW)
  } else {
    out += line(pad.x, y, 12.5, [{ text: 'Context: waiting for the first reading', color: TOKENS.text4 }])
  }
  y += h1 + ROW_GAP

  // Row 2: legend (wraps; 12px between items, 4px between lines)
  if (ctx && size !== 'd') {
    const items: Run[][] = ctx.segments.map(s => [
      { text: '●', color: s.color },
      { text: ` ${s.label} ${fmtTokens(s.tokens)}`, color: TOKENS.text2 },
    ])
    items.push([{ text: `Free ${fmtTokens(ctx.free)}`, color: TOKENS.text4 }])
    // Lines decided with the metrics; within a line the font itself flows the runs.
    const lines: Run[][][] = [[]]
    let x = pad.x
    for (const it of items) {
      const w = runsWidth(it, 11.5)
      if (x > pad.x && x + w > pad.x + inner) {
        lines.push([])
        x = pad.x
      }
      lines[lines.length - 1]!.push(it)
      x += w + 12
    }
    let lineTop = y
    lines.forEach((ln, i) => {
      if (i > 0) lineTop += lh(11.5) + 4
      const base = r2(baseline(lineTop, 11.5))
      const spans = ln
        .map((it, j) =>
          it
            .map((r, k) => `<tspan${j > 0 && k === 0 ? ' dx="12"' : ''} fill="${r.color}">${esc(r.text)}</tspan>`)
            .join(''),
        )
        .join('')
      out += `<text x="${pad.x}" y="${base}" font-size="11.5" xml:space="preserve">${spans}</text>`
    })
    y = lineTop + lh(11.5) + ROW_GAP
  }

  // Row 3: limits + cache
  const c = vm.cache
  if (wide) {
    const gap = size === 'a' ? 18 : 12
    const colW = (inner - gap * 3) / 4
    const ts = size === 'a' ? 13 : 12.5
    const col = (i: number) => pad.x + i * (colW + gap)
    vm.limits.forEach((l, i) => {
      const x = col(i)
      const clip = id()
      out += `<clipPath id="${clip}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(colW)}" height="80"/></clipPath>`
      let yy = y
      out += line(x, yy, ts, fitRuns([{ text: l.title, color: l.usage === null ? TOKENS.text4 : TOKENS.text, bold: true }], ts, colW), 'start', clip)
      yy += lh(ts) + 5
      out += limitBar(id(), l, x, yy, colW)
      yy += 8 + 5
      const usage: Run[] =
        l.usage === null
          ? [{ text: 'No data', color: TOKENS.text4 }]
          : [
              { text: `Usage ${pct(l.usage)}% · `, color: TOKENS.text },
              { text: l.time === null ? '' : `Time ${pct(l.time)}%`, color: TOKENS.text3 },
            ]
      out += line(x, yy, 11.5, fitRuns(usage, 11.5, colW), 'start', clip)
      yy += lh(11.5) + 5
      out += line(x, yy, 11.5, fitRuns([{ text: l.reset, color: TOKENS.text4 }], 11.5, colW), 'start', clip)
    })
    {
      const x = col(3)
      const clip = id()
      out += `<clipPath id="${clip}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(colW)}" height="80"/></clipPath>`
      let yy = y
      out += line(
        x,
        yy,
        ts,
        fitRuns(
          [
            { text: 'Cache · ', color: TOKENS.text, bold: true },
            { text: c.label, color: c.color, bold: true },
          ],
          ts,
          colW,
        ),
        'start',
        clip,
      )
      yy += lh(ts) + 5
      out += tempBar(id(), c, x, yy, colW)
      yy += 8 + 5
      const warm: Run[] = [
        { text: c.state === 'empty' ? 'Warmth — · ' : `Warmth ${pct(c.warmth * 100)}% · `, color: TOKENS.text },
        { text: `Hit ${c.hit === null ? '—' : `${pct(c.hit)}%`}`, color: TOKENS.text3 },
      ]
      out += line(x, yy, 11.5, fitRuns(warm, 11.5, colW), 'start', clip)
      yy += lh(11.5) + 5
      out += line(x, yy, 11.5, fitRuns([{ text: c.detail, color: TOKENS.text4 }], 11.5, colW), 'start', clip)
    }
    y += lh(ts) + 5 + 8 + 5 + lh(11.5) + 5 + lh(11.5) + ROW_GAP
  } else {
    // Rings: four items spread with space-between, each a 30px ring, 6px, then text.
    const twoLines = size === 'c'
    const items = [
      ...vm.limits.map(l => ({
        ring: { usage: l.usage, time: l.time, bright: l.bright, dark: l.dark, icon: LIMIT_ICON[l.kind], iconColor: l.bright },
        main: { text: l.usage === null ? '—' : `${pct(l.usage)}%`, color: TOKENS.text },
        sub: l.time === null ? '' : `Time ${pct(l.time)}%`,
      })),
      {
        ring: {
          usage: c.state === 'empty' ? null : c.warmth * 100,
          time: null,
          bright: c.color,
          dark: c.color,
          icon: cacheIcon(c),
          iconColor: c.color,
        },
        main: {
          text: twoLines || c.state === 'cold' || c.state === 'empty' ? c.label : `${pct(c.warmth * 100)}%`,
          color: c.color,
        },
        sub: c.state === 'empty' ? 'Nothing cached' : `${pct(c.warmth * 100)}% warm`,
      },
    ]
    const widths = items.map(it => 30 + 6 + Math.max(textWidth(it.main.text, 13, true), twoLines ? textWidth(it.sub, 10.5) : 0))
    const free = Math.max(0, inner - widths.reduce((a, b) => a + b, 0))
    const step = free / (items.length - 1)
    const textH = twoLines ? 13 * 1.25 + 10.5 * 1.25 : 13 * 1.25
    const rowH = Math.max(30, textH)
    let x = pad.x
    items.forEach((it, i) => {
      out += ring(x, y + (rowH - 30) / 2, it.ring)
      const tx = x + 36
      const ty = y + (rowH - textH) / 2
      // line-height 1.25: the 13px line is 16.25 tall, the 10.5px one 13.125
      out += `<text x="${r2(tx)}" y="${r2(baseline(ty, 13, 16.25))}" font-size="13" font-weight="700" fill="${it.main.color}">${esc(it.main.text)}</text>`
      if (twoLines) {
        out += `<text x="${r2(tx)}" y="${r2(baseline(ty + 16.25, 10.5, 13.125))}" font-size="10.5" fill="${TOKENS.text3}">${esc(it.sub)}</text>`
      }
      x += (widths[i] ?? 0) + step
    })
    y += rowH + ROW_GAP
  }

  // Notice: beside the buttons when wide; above them, wrapped, when narrow.
  let notice: PanelSvg['notice'] = null
  let noticeWraps = false
  const buttonsWidth = buttonsWidthOf() + pad.x
  if (vm.notice) {
    noticeWraps = wide && 15 + textWidth(vm.notice, 12.5) + 12 + buttonsWidthOf() > inner
    if (wide && !noticeWraps) {
      const nw = Math.max(80, W - buttonsWidth - 12)
      const top = (BUTTON_H - lh(12.5)) / 2
      const body =
        `<circle cx="${pad.x + 3.5}" cy="${r2(BUTTON_H / 2)}" r="3.5" fill="${c.color}"/>` +
        line(pad.x + 15, top, 12.5, [{ text: ellipsize(vm.notice, 12.5, nw - pad.x - 15), color: TOKENS.text2 }])
      notice = { svg: svgDoc(nw, BUTTON_H, body, vm.notice), width: nw, height: BUTTON_H }
    } else {
      const maxW = inner - 15 // narrow, or wide with the buttons wrapped below
      // Break where the browser would: after spaces, and after hyphens.
      const words = vm.notice.match(/[^\s-]*-|[^\s-]+\s*|\s+/g) ?? [vm.notice]
      const lines: string[] = []
      let cur = ''
      for (const w of words) {
        const next = cur + w
        if (cur && textWidth(next.trimEnd(), 12.5) > maxW) {
          lines.push(cur.trimEnd())
          cur = w.trimStart()
        } else cur = next
      }
      if (cur.trim()) lines.push(cur.trimEnd())
      const blockH = lines.length * lh(12.5)
      out += `<circle cx="${pad.x + 3.5}" cy="${r2(y + blockH / 2)}" r="3.5" fill="${c.color}"/>`
      lines.forEach((t, i) => {
        out += line(pad.x + 15, y + i * lh(12.5), 12.5, [{ text: t, color: TOKENS.text2 }])
      })
      y += blockH + (noticeWraps ? 12 : ROW_GAP)
    }
  }

  const alt = [
    ctx ? `Context ${ctx.usedLabel}` : 'Context: no reading',
    ...vm.limits.map(l => `${l.title}: ${l.usage === null ? 'no data' : `${pct(l.usage)}% used, ${pct(l.time ?? 0)}% of time`}`),
    `Cache ${c.label}, ${c.detail}`,
  ].join('. ')
  // The bottom gap belongs to the buttons row when there is one.
  const height = vm.notice ? y : y - ROW_GAP + pad.y
  return { size, alt, body: { svg: svgDoc(W, height, out, alt), width: W, height }, notice, buttonsWidth, noticeWraps, pad }
}
