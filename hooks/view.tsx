// Drawing for the context-cache panel: one view model, two renderers.
// Terminal: block-character bars in the design's colours, text glyphs for rings.
// Desktop (and the editor, the phone's pane): the design drawn as SVG, host buttons.

import type { Elements } from 'claude-code'

import { fmtTokens, pct, TOKENS, tempColorAt, mix, type CacheView, type LimitView, type ViewModel } from './model'
import { panelSvg } from './panel-svg'

export type Actions = {
  clear: () => void | Promise<void>
  compact: () => void | Promise<void>
  /** Starts keep-warm, or stops it while on. */
  warm: () => void | Promise<void>
  isWarming: boolean
}

type TermEls = Elements['terminal']
type DeskEls = Elements['desktop'] | Elements['vscode'] | Elements['mobile']

const BAR = '━'
const TICK = '┃'

// ── Shared bits ────────────────────────────────────────────────────────────

function usageLine(l: LimitView): { main: string; time: string } {
  if (l.usage === null) return { main: 'No data', time: '' }
  return { main: `Usage ${pct(l.usage)}%`, time: l.time === null ? '' : ` · Time ${pct(l.time)}%` }
}

function cacheLine(c: CacheView): { main: string; hit: string } {
  if (c.state === 'empty') return { main: 'Warmth —', hit: c.hit === null ? '' : ` · Hit ${pct(c.hit)}%` }
  return { main: `Warmth ${pct(c.warmth * 100)}%`, hit: ` · Hit ${c.hit === null ? '—' : `${pct(c.hit)}%`}` }
}

// ── Terminal ───────────────────────────────────────────────────────────────

type Cell = { ch: string; color: string }

/** Context bar: one cell run per group, the auto-compact tick over it. */
export function contextCells(vm: NonNullable<ViewModel['context']>, n: number): Cell[] {
  const cells: Cell[] = Array.from({ length: n }, () => ({ ch: BAR, color: TOKENS.track }))
  let acc = 0
  for (const s of vm.segments) {
    const start = Math.round((acc / vm.window) * n)
    acc += s.tokens
    const end = Math.min(n, Math.round((acc / vm.window) * n))
    for (let i = start; i < end; i++) cells[i] = { ch: BAR, color: s.color }
  }
  if (vm.compactPct !== null) {
    const i = Math.min(n - 1, Math.floor((vm.compactPct / 100) * n))
    cells[i] = { ch: TICK, color: TOKENS.tick }
  }
  return cells
}

/** Double bar: dark = time (to max of both), bright = usage, tick at time. */
export function limitCells(l: LimitView, n: number): Cell[] {
  const u = l.usage ?? 0
  const t = l.time ?? 0
  // Any usage at all shows as at least one cell.
  const brightEnd = u > 0 ? Math.max(1, Math.round((u / 100) * n)) : 0
  const darkEnd = Math.max(brightEnd, Math.round((Math.max(u, t) / 100) * n))
  const cells: Cell[] = Array.from({ length: n }, (_, i) => ({
    ch: BAR,
    color: i < brightEnd ? l.bright : i < darkEnd ? l.dark : TOKENS.track,
  }))
  // The time tick; at the very start of a window it would hide the bar's first cell.
  const tickAt = Math.min(n - 1, Math.round((t / 100) * n))
  if (l.usage !== null && l.time !== null && tickAt >= 1) {
    cells[tickAt] = { ch: TICK, color: TOKENS.tick }
  }
  return cells
}

/** Temperature bar: the gradient, covered right of the current warmth, a tick at it. */
export function tempCells(c: CacheView, n: number): Cell[] {
  const cells: Cell[] = Array.from({ length: n }, (_, i) => {
    const x = (i + 0.5) / n
    const color = tempColorAt(x)
    return { ch: BAR, color: x > c.warmth ? mix(color, TOKENS.card, 0.74) : color }
  })
  if (c.state !== 'empty' && c.warmth > 0) {
    cells[Math.min(n - 1, Math.floor(c.warmth * n))] = { ch: TICK, color: TOKENS.tick }
  }
  return cells
}

function runsOf(cells: Cell[]): { text: string; color: string }[] {
  const runs: { text: string; color: string }[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.color === c.color) last.text += c.ch
    else runs.push({ text: c.ch, color: c.color })
  }
  return runs
}

const TERM_GLYPH = { session: '◷', weekly: '▦', fable: '✦' } as const
function cacheGlyph(c: CacheView): string {
  return c.state === 'cold' ? '❄' : c.state === 'empty' ? '○' : '♨'
}

export function renderTerminal(E: TermEls, vm: ViewModel, columns: number, actions: Actions) {
  const { Box, Text, Button } = E
  const inner = Math.max(20, columns - 4)
  const wide = vm.size === 'a' || vm.size === 'b'

  const bar = (cells: Cell[]) => (
    <Text wrap="truncate">
      {runsOf(cells).map(r => (
        <Text color={r.color}>{r.text}</Text>
      ))}
    </Text>
  )

  // Row 1: context
  const ctx = vm.context
  const contextRow = ctx ? (
    <Box flexDirection="row">
      <Text bold color={TOKENS.text}>Context </Text>
      <Text color={TOKENS.text3}>{ctx.usedLabel} </Text>
      {bar(contextCells(ctx, Math.max(6, inner - 8 - ctx.usedLabel.length - 1 - ctx.rightLabel.length - 1)))}
      <Text color={TOKENS.text4}> {ctx.rightLabel}</Text>
    </Box>
  ) : (
    <Text color={TOKENS.text4}>Context: waiting for the first reading</Text>
  )

  // Row 2: legend
  const legend =
    ctx && vm.showLegend ? (
      <Text wrap="wrap">
        {ctx.segments.map(s => (
          <Text>
            <Text color={s.color}>● </Text>
            <Text color={TOKENS.text2}>{`${s.label} ${fmtTokens(s.tokens)}  `}</Text>
          </Text>
        ))}
        <Text color={TOKENS.text4}>{`Free ${fmtTokens(ctx.free)}`}</Text>
      </Text>
    ) : null

  // Row 3: limits + cache
  let limitsRow
  if (wide) {
    const gap = vm.size === 'a' ? 3 : 2
    const colW = Math.max(8, Math.floor((inner - 3 * gap) / 4))
    const limitCol = (l: LimitView) => {
      const line = usageLine(l)
      return (
        <Box key={`limit-${l.kind}`} flexDirection="column" width={colW}>
          <Text bold wrap="truncate" color={l.usage === null ? TOKENS.text4 : TOKENS.text}>
            {l.title}
          </Text>
          {bar(limitCells(l, colW))}
          <Text wrap="truncate">
            <Text color={TOKENS.text}>{line.main}</Text>
            <Text color={TOKENS.text3}>{line.time}</Text>
          </Text>
          <Text wrap="truncate" color={TOKENS.text4}>
            {l.reset}
          </Text>
        </Box>
      )
    }
    const c = vm.cache
    const cl = cacheLine(c)
    limitsRow = (
      <Box flexDirection="row" columnGap={gap}>
        {vm.limits.map(limitCol)}
        <Box key="cache" flexDirection="column" width={colW}>
          <Text bold wrap="truncate">
            <Text color={TOKENS.text}>Cache · </Text>
            <Text color={c.color}>{c.label}</Text>
          </Text>
          {bar(tempCells(c, colW))}
          <Text wrap="truncate">
            <Text color={TOKENS.text}>{cl.main}</Text>
            <Text color={TOKENS.text3}>{cl.hit}</Text>
          </Text>
          <Text wrap="truncate" color={TOKENS.text4}>
            {c.detail}
          </Text>
        </Box>
      </Box>
    )
  } else {
    const showTime = vm.size === 'c'
    const ring = (l: LimitView) => (
      <Box key={`limit-${l.kind}`} flexDirection="column">
        <Text>
          <Text color={l.bright}>{TERM_GLYPH[l.kind]} </Text>
          <Text bold color={l.usage === null ? TOKENS.text4 : TOKENS.text}>
            {l.usage === null ? '—' : `${pct(l.usage)}%`}
          </Text>
        </Text>
        {showTime && <Text color={TOKENS.text3}>{l.time === null ? ' ' : `Time ${pct(l.time)}%`}</Text>}
      </Box>
    )
    const c = vm.cache
    const cacheMain =
      c.state === 'cold' || c.state === 'empty' ? (showTime ? c.label : c.label) : showTime ? c.label : `${pct(c.warmth * 100)}%`
    limitsRow = (
      <Box flexDirection="row" justifyContent="space-between">
        {vm.limits.map(ring)}
        <Box key="cache" flexDirection="column">
          <Text>
            <Text color={c.color}>{cacheGlyph(c)} </Text>
            <Text bold color={TOKENS.text}>
              {cacheMain}
            </Text>
          </Text>
          {showTime && (
            <Text color={TOKENS.text3}>
              {c.state === 'warm' || c.state === 'cooling' ? `${pct(c.warmth * 100)}% warm` : c.detail}
            </Text>
          )}
        </Box>
      </Box>
    )
  }

  // Row 4: notice + actions
  const buttons = (
    <Box flexDirection="row" columnGap={1}>
      <Button key="clear" label="Clear" variant="primary" hotkey="c" onPress={actions.clear} />
      <Button key="compact" label="Compact" hotkey="k" onPress={actions.compact} />
      <Button key="warm" label={actions.isWarming ? 'Stop' : 'Warm'} hotkey="w" onPress={actions.warm} />
    </Box>
  )
  const notice = vm.notice
    ? wide ? (
        <Box flexDirection="row" columnGap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate">
              <Text color={vm.cache.color}>● </Text>
              <Text color={TOKENS.text2}>{vm.notice}</Text>
            </Text>
          </Box>
          {buttons}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text wrap="wrap">
            <Text color={vm.cache.color}>● </Text>
            <Text color={TOKENS.text2}>{vm.notice}</Text>
          </Text>
          {buttons}
        </Box>
      )
    : null

  return (
    <Box
      key="context-cache"
      flexDirection="column"
      borderStyle="round"
      borderColor={TOKENS.border}
      paddingX={1}
    >
      {contextRow}
      {legend}
      {limitsRow}
      {notice}
    </Box>
  )
}

// ── Desktop (and the editor, and the phone's pane) ─────────────────────────
//
// The design at its real pixel sizes: hooks/panel-svg.ts lays rows 1–3 (and a
// narrow layout's notice) out as one SVG, the host draws the card around it
// and its own buttons for Clear / Compact. The SVG is drawn at the
// width the band is believed to be (cells × px per cell, see /cache scale);
// where the slot is narrower the host scales it down to fit, so it always
// fills the width whole and resizes without reflowing.

export function renderDesktop(E: DeskEls, vm: ViewModel, widthPx: number, actions: Actions) {
  const { Box, Button, Svg } = E
  const p = panelSvg(vm, Math.max(240, widthPx))
  const wide = p.size === 'a' || p.size === 'b'
  const padX = p.size === 'd' ? 1 : 2
  const button = (key: 'clear' | 'compact' | 'warm', label: string, hotkey: string, extra: Record<string, unknown>) => (
    <Button key={key} label={label} hotkey={hotkey} onPress={actions[key]} {...extra} />
  )
  const buttons = (
    <Box flexDirection="row" columnGap={1}>
      {button('clear', 'Clear', 'c', { variant: 'primary' })}
      {button('compact', 'Compact', 'k', {})}
      {button('warm', actions.isWarming ? 'Stop' : 'Warm', 'w', {})}
    </Box>
  )
  let actionsRow = null
  if (vm.notice) {
    actionsRow =
      wide && p.notice ? (
        <Box flexDirection="row" alignItems="center" columnGap={1} paddingRight={padX} paddingBottom={1}>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Svg source={p.notice.svg} alt={vm.notice} />
          </Box>
          {buttons}
        </Box>
      ) : (
        // The notice is in the SVG above; the buttons sit together under it.
        // (The design's equal-width buttons need stretchable controls, which the host's native buttons are not.)
        <Box flexDirection="row" paddingX={padX} paddingBottom={1}>{buttons}</Box>
      )
  }
  return (
    <Box key="context-cache" flexDirection="column" borderStyle="round" borderColor={TOKENS.border} backgroundColor={TOKENS.card}>
      <Svg source={p.body.svg} alt={p.alt} />
      {actionsRow}
    </Box>
  )
}
