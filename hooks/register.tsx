// context-cache: a panel above the prompt with context usage, usage limits
// (session, weekly, Fable) and prompt-cache temperature, plus Clear / Compact.
//
// Where each number comes from (all real, nothing sampled):
// - Context: $.session.usage() (the status line's figures) and its /context
//   breakdown; Files is the share of Messages that is file contents read.
// - Limits: the account usage endpoint (api.anthropic.com/api/oauth/usage),
//   called with the session's own credential through the host; falls back to
//   the rate-limit headers of the last response.
// - Cache: the time of the last main-thread response, the TTL the responses
//   were cached with (read from the transcript's usage, or the engine's own
//   model-switch report), and the last turn's cache-read share.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextCacheCache, ContextCacheLimit, ContextCacheSnapshot } from '../types'
import {
  buildContext,
  buildView,
  cacheView,
  isNarrow,
  fmtClock,
  fmtTokens,
  noticeText,
  pct,
  type ViewModel,
  fileShareOf,
  limitsFromResponse,
  parseAccountUsage,
  TTL_1H,
  TTL_5M,
  usageWindowsOf,
} from './model'
import { renderDesktop, renderTerminal, type Actions } from './view'

const snapshotAtom = atom({ plugin: 'context-cache', key: 'snapshot' } as const, null)
const hiddenAtom = atom({ plugin: 'context-cache', key: 'isHidden' } as const, false)
const nowAtom = atom({ plugin: 'context-cache', key: 'now' } as const, 0)
// Desktop and mobile draw the design in CSS px, but the band is measured in
// cells; this is the conversion. 8 fits the desktop app's default font;
// /cache scale <px> adjusts it and the value is kept across sessions.
const pxPerCellAtom = atom({ plugin: 'context-cache', key: 'pxPerCell' } as const, 8)
const DEFAULT_PX_PER_CELL = 8
const warmUntilAtom = atom({ plugin: 'context-cache', key: 'warmUntil' } as const, null)

// Keep-warm: a cache read resets the 1h TTL for free, so one tool-less fork of
// the main thread 55 min after the last reply keeps it alive at ~0.1x of the
// context per ping (a cold rewrite is 2x). The fork never enters the transcript.
const WARM_AFTER_MS = 55 * 60_000
const WARM_FOR_MS = 8 * 60 * 60_000
const WARM_PROMPT = 'Keep-alive ping for the prompt cache. Reply with only: ok'
let warmInFlight = false
/** The last successful ping of this warming run, for the notice line. */
let lastPing: { at: number; read: number } | null = null

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
// The account endpoint answers 429 to anyone who leans on it; the status-line
// tools that use it hold to one request per 5 minutes, so this does too. The
// 5h/7d figures still move every response through the rate-limit headers.
const ACCOUNT_EVERY_MS = 5 * 60_000
// Two reset times this close describe the same window (the sources round differently).
const SAME_WINDOW_MS = 30 * 60_000
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024 - 1024

const emptyCache = (ttlMs: number, isTtlKnown: boolean): ContextCacheCache => ({
  lastAt: null,
  ttlMs,
  isTtlKnown,
  hitRate: null,
})

/** The TTL a response was cached with, from a transcript line's usage. */
export function ttlFromTranscript(text: string): number | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1, seen = 0; i >= 0 && seen < 400; i--, seen++) {
    const line = lines[i]
    if (!line || !line.includes('cache_creation')) continue
    try {
      const row = JSON.parse(line) as { message?: { usage?: { cache_creation?: Record<string, number> } } }
      const cc = row.message?.usage?.cache_creation
      if (!cc) continue
      if ((cc['ephemeral_1h_input_tokens'] ?? 0) > 0) return TTL_1H
      if ((cc['ephemeral_5m_input_tokens'] ?? 0) > 0) return TTL_5M
    } catch {
      // a partial line; keep looking
    }
  }
  return null
}

// Module state: rebuilt on reload; what the drawing needs lives in $.state.
let accountLimits: ContextCacheLimit[] | null = null
let accountAt = 0
let accountInFlight = false
let refreshing: Promise<void> | null = null
// Diagnostics for /cache status: what asked the mod to draw, and where, and
// how the last account usage request went.
const draws: Record<string, number> = {}
const attached: string[] = []
let cwd = ''
const DIAG_FILE = 'context-cache-status.json' // written in the session's working directory
type AccountDiag = {
  at: number
  authKind: string
  status: number | null
  ok: boolean | null
  topLevelKeys: string[]
  /** JSON paths of every node with a utilization figure, and which matched Fable. */
  windows: string[]
  fableMatched: string[]
  bodyPreview: string
  error: string | null
}
let lastAccount: AccountDiag | null = null

function noteDraw(component: string, surface: string) {
  const k = `${component}@${surface}`
  draws[k] = (draws[k] ?? 0) + 1
}

async function statusReport($: EngineInterface): Promise<string> {
  let surfaces: readonly string[] = []
  try {
    surfaces = await $.session.surfaces()
  } catch {
    surfaces = []
  }
  const [snap, hidden, pxPerCell, warmUntil] = await Promise.all([
    read($, snapshotAtom),
    read($, hiddenAtom),
    read($, pxPerCellAtom),
    read($, warmUntilAtom),
  ])
  const drawn = Object.entries(draws).map(([k, n]) => `${k} Ã—${n}`).join(', ') || 'nothing yet'
  const a = lastAccount
  const account = a
    ? `auth ${a.authKind}, HTTP ${a.status ?? 'â€”'}${a.ok === false ? ' (not ok)' : ''}` +
      `${a.error ? `, error: ${a.error}` : ''}; keys: ${a.topLevelKeys.join(', ') || 'â€”'}; ` +
      `windows: ${a.windows.join(', ') || 'none'}; Fable matched: ${a.fableMatched.join(', ') || 'none'}`
    : 'not attempted yet'
  const lines = [
    `Surfaces attached now: ${surfaces.length ? surfaces.join(', ') : 'none'}`,
    `Clients that attached since load: ${attached.length ? attached.join(', ') : 'none seen'}`,
    `Draw requests received: ${drawn}`,
    `Panel hidden: ${hidden ? 'yes' : 'no'}; px per cell: ${pxPerCell} (/cache scale <px> changes it)`,
    `Context: ${snap?.context ? `${snap.context.used} / ${snap.context.window}` : 'no reading'}`,
    `Limits: ${snap?.limits.length ? snap.limits.map(l => `${l.kind} ${l.usage}%`).join(', ') : 'none'} (source: ${snap?.limitsSource ?? 'none'})`,
    `Account usage request: ${account}`,
    `Cache: last write ${snap?.cache.lastAt ? new Date(snap.cache.lastAt).toISOString() : 'none'}, TTL ${snap ? snap.cache.ttlMs / 60000 : '?'}m${snap?.cache.isTtlKnown ? '' : ' (default)'}`,
    `Warming: ${warmUntil === null ? 'off' : `on until ${fmtClock(warmUntil)}; ${snap ? (await warmNote($, snap)) || 'no note' : 'no snapshot'}`}`,
    `Full report: ${cwd ? `${cwd}/` : ''}${DIAG_FILE}`,
  ]
  const text = lines.join('\n')
  try {
    await $.fs.write(
      DIAG_FILE,
      JSON.stringify({ at: await $.clock.now(), surfaces, attached, draws, hidden, pxPerCell, account: lastAccount, snap }, null, 2),
    )
  } catch {
    // diagnostics only
  }
  return text
}

async function current($: EngineInterface): Promise<ContextCacheSnapshot> {
  const snap = await read($, snapshotAtom)
  if (snap) return snap
  const stored = await $.store.get('ttlMs')
  const ttl = stored === TTL_5M || stored === TTL_1H ? stored : TTL_1H
  return {
    context: null,
    limits: [],
    limitsSource: 'none',
    cache: emptyCache(ttl, stored === TTL_5M || stored === TTL_1H),
    updatedAt: await $.clock.now(),
  }
}

async function patchCache($: EngineInterface, patch: Partial<ContextCacheCache>) {
  const base = await current($)
  await update($, snapshotAtom, prev => {
    const s = prev ?? base
    return { ...s, cache: { ...s.cache, ...patch } }
  })
}

async function setTtl($: EngineInterface, ttlMs: number) {
  await $.store.set('ttlMs', ttlMs)
  await patchCache($, { ttlMs, isTtlKnown: true })
}

async function fetchAccount($: EngineInterface, now: number, force: boolean) {
  if (accountInFlight) return
  if (!force && now - accountAt < ACCOUNT_EVERY_MS) return
  accountInFlight = true
  const diag: AccountDiag = { at: now, authKind: 'none', status: null, ok: null, topLevelKeys: [], windows: [], fableMatched: [], bodyPreview: '', error: null }
  lastAccount = diag
  try {
    const auth = await $.session.authorize()
    diag.authKind = auth ? auth.kind : 'none'
    if (!auth || auth.kind !== 'bearer') return
    const res = await $.http.fetch(USAGE_URL, {
      auth: auth.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
    })
    diag.status = res.status
    diag.ok = res.ok
    diag.bodyPreview = res.text.slice(0, 2000)
    if (res.status === 429) {
      // Back off a whole interval (or what retry-after asks) before trying again.
      const retry = Number(res.headers['retry-after'])
      accountAt = now + (Number.isFinite(retry) && retry > 0 ? Math.max(0, retry * 1000 - ACCOUNT_EVERY_MS) : 0)
      return
    }
    if (!res.ok) return
    const json: unknown = JSON.parse(res.text)
    if (json && typeof json === 'object') diag.topLevelKeys = Object.keys(json as object)
    const found = usageWindowsOf(json)
    diag.windows = found.map(f => `${f.path}=${f.usage}%`)
    diag.fableMatched = found.filter(f => f.isFable).map(f => f.path)
    const limits = parseAccountUsage(json)
    if (limits.length > 0) {
      accountLimits = limits
      accountAt = now
    }
  } catch (err) {
    // keep the last good reading; the response headers cover the gap
    diag.error = err instanceof Error ? err.message : String(err)
  } finally {
    accountInFlight = false
  }
}

// The Files share of the conversation: reading the whole transcript is the
// dear part of a refresh, so it is done once per turn and reused between.
let fileShare = 0
let fileShareTurn = -1
let turnNo = 0

async function doRefresh($: EngineInterface, forceAccount: boolean) {
  const now = await $.clock.now()
  const prev = await current($)

  let context = prev.context
  let responseLimits: ContextCacheLimit[] = []
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    responseLimits = limitsFromResponse(usage.rateLimits)
    const b = usage.context.breakdown
    if (fileShareTurn !== turnNo) {
      try {
        const msgs = await $.session.messages()
        if (Array.isArray(msgs)) fileShare = fileShareOf(msgs)
        fileShareTurn = turnNo
      } catch {
        // keep the last share
      }
    }
    context = buildContext({
      categories: b?.categories ?? [],
      realTokens: usage.context.tokens ?? b?.totalTokens,
      window: usage.context.window,
      autoCompactAt: b?.autoCompactThreshold,
      isAutoCompactEnabled: b?.isAutoCompactEnabled ?? false,
      fileShare,
    })
  } catch {
    // keep the last context reading
  }

  await fetchAccount($, now, forceAccount)
  // A reload empties module memory but not the session's snapshot: a recent
  // account reading there still stands, so Fable does not blink out meanwhile.
  if (accountLimits === null && prev.limitsSource === 'account' && now - prev.updatedAt < 10 * ACCOUNT_EVERY_MS) {
    accountLimits = prev.limits
    accountAt = prev.updatedAt
  }
  const isAccountFresh = accountLimits !== null && now - accountAt < 10 * ACCOUNT_EVERY_MS
  let limits: ContextCacheLimit[]
  let limitsSource: ContextCacheSnapshot['limitsSource']
  if (isAccountFresh && accountLimits) {
    // The headers arrive with every reply and the account reading is up to 5
    // minutes old, yet the headers can trail it (weekly 25% against the
    // account's and /usage's 26%). Usage only climbs inside a window, so for
    // the same window the higher reading is the newer one; across a reset the
    // later window wins. The account adds what the headers lack (Fable).
    limits = [
      ...responseLimits.map(r => {
        const a = accountLimits!.find(x => x.kind === r.kind)
        if (!a) return r
        const resetsAt = r.resetsAt ?? a.resetsAt
        if (resetsAt !== null && a.resetsAt !== null && Math.abs(resetsAt - a.resetsAt) > SAME_WINDOW_MS) {
          return a.resetsAt > resetsAt ? a : { ...r, resetsAt }
        }
        return { ...r, resetsAt, usage: Math.max(r.usage, a.usage) }
      }),
      ...accountLimits.filter(a => !responseLimits.some(r => r.kind === a.kind)),
    ]
    limitsSource = 'account'
  } else if (responseLimits.length > 0) {
    limits = responseLimits
    limitsSource = 'response'
  } else {
    limits = prev.limits
    limitsSource = prev.limitsSource
  }

  await update($, snapshotAtom, latest => {
    const s = latest ?? prev
    return { ...s, context, limits, limitsSource, updatedAt: now }
  })
  await update($, nowAtom, () => now)
}

function refresh($: EngineInterface, forceAccount = false): Promise<void> {
  if (refreshing) return refreshing
  refreshing = doRefresh($, forceAccount)
    .catch(() => undefined) // a refresh outliving its session, or a refused write: the next one retries
    .finally(() => {
    refreshing = null
  })
  return refreshing
}

async function learnTtl($: EngineInterface, transcriptPath: string) {
  if (!transcriptPath) return
  try {
    const stat = await $.fs.stat(transcriptPath)
    if (stat.size > MAX_TRANSCRIPT_BYTES) return
    const text = await $.fs.read(transcriptPath)
    const ttl = ttlFromTranscript(typeof text === 'string' ? text : '')
    if (ttl !== null) await setTtl($, ttl)
  } catch {
    // unreadable: the stored TTL stands
  }
}

const PANE = 'context-cache'

const COMMANDS = [
  { name: 'cache', description: 'Context & cache panel: show or hide it' },
  { name: 'cache-status', description: 'Context & cache panel: where each figure comes from (surfaces, draws, the account usage request, Fable)' },
  { name: 'cache-pane', description: 'Context & cache panel: open it as a pane (the way it shows on mobile)' },
  { name: 'cache-refresh', description: 'Context & cache panel: re-read usage now' },
  { name: 'cache-scale', description: 'Context & cache panel: px per cell the desktop draws at (default 8); a number sets it, none steps it', argumentHint: '[px]' },
] as const

async function hasMobile($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).includes('mobile')
  } catch {
    return false
  }
}

/** The card's inner width in CSS px on a remote surface: the band's cells Ã— px per cell, less the border. */
async function widthPx($: EngineInterface, columns: number): Promise<number> {
  return columns * (await read($, pxPerCellAtom)) - 2
}

/** The size classes are set in the design's cells (8px each): a px width as that many. */
function designCells(px: number): number {
  return px / DEFAULT_PX_PER_CELL
}

/** The view model for a drawing, or null while hidden or before any reading. */
async function panelModel($: EngineInterface, columns: number, maxRows: number): Promise<ViewModel | null> {
  const [snap, hidden, tick] = await Promise.all([read($, snapshotAtom), read($, hiddenAtom), read($, nowAtom)])
  if (hidden || !snap) return null
  const vm = buildView(snap, Math.max(tick, snap.updatedAt), columns, maxRows)
  const warm = await warmNote($, snap, isNarrow(vm.size))
  return warm ? { ...vm, notice: warm } : vm
}

/** While warming, the notice line in place of the usual one, kept as short: the last ping and the next. */
async function warmNote($: EngineInterface, { cache, context }: ContextCacheSnapshot, short = false): Promise<string> {
  if ((await read($, warmUntilAtom)) === null || cache.lastAt === null) return ''
  const next = fmtClock(cache.lastAt + WARM_AFTER_MS)
  if (short) return lastPing ? `Warmed ${fmtClock(lastPing.at)}, next ${next}.` : `Kept warm: next ping ${next}.`
  return lastPing
    ? `Kept warm at ${fmtClock(lastPing.at)}, reuses ${fmtTokens(lastPing.read)}. Next ${next}.`
    : `Kept warm: next message reuses ${context ? fmtTokens(context.used) : "the cache"}. Ping at ${next}.`
}

/** Why the cache can't be kept warm now, or null when it can. */
function whyNoWarm(cache: ContextCacheCache, now: number): string | null {
  if (cache.ttlMs !== TTL_1H) return 'this session uses the 5-minute cache; pinging every few minutes costs more than letting it go cold'
  if (cache.lastAt === null) return 'nothing is cached yet'
  if (now - cache.lastAt >= cache.ttlMs) return 'the cache has already gone cold'
  return null
}

async function stopWarm($: EngineInterface, why: string) {
  await update($, warmUntilAtom, () => null)
  $.ui.toast(`Warming stopped: ${why}.`)
}

/** Checked every 15s while warming: pings once the cache is 55 min old. */
async function warmTick($: EngineInterface) {
  const until = await read($, warmUntilAtom)
  if (until === null || warmInFlight) return
  const now = await $.clock.now()
  const { cache } = await current($)
  if (now >= until) return stopWarm($, 'it ran for 8 hours')
  const why = whyNoWarm(cache, now)
  if (why) return stopWarm($, why)
  if (now - cache.lastAt! < WARM_AFTER_MS) return
  warmInFlight = true
  try {
    const r = await $.model.fork({ prompt: WARM_PROMPT })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') return stopWarm($, 'nothing is cached yet')
    const u = 'usage' in r ? r.usage : undefined
    if (u && u.cache_read_input_tokens > 0) {
      const at = await $.clock.now()
      lastPing = { at, read: u.cache_read_input_tokens }
      await patchCache($, { lastAt: at })
      $.ui.toast(`Kept the cache warm at ${fmtClock(at)} (read ${fmtTokens(u.cache_read_input_tokens)} from cache). Next ping ${fmtClock(at + WARM_AFTER_MS)}.`)
    }
    else if (u && u.cache_creation_input_tokens > 0) await stopWarm($, 'the ping missed the cache and rewrote it')
    // else an API error: the next tick retries while the cache is still warm
  } finally {
    warmInFlight = false
  }
}

/** Clear, Compact and Warm/Stop. None hides the notice row: it stays on whatever the cache holds. */
async function actionsFor($: EngineInterface, isWorking: boolean): Promise<Actions> {
  const isWarming = (await read($, warmUntilAtom)) !== null
  return {
    isWarming,
    warm: async () => {
      if ((await read($, warmUntilAtom)) !== null) {
        await update($, warmUntilAtom, () => null)
        $.ui.toast('Warming stopped.')
        return
      }
      const now = await $.clock.now()
      const why = whyNoWarm((await current($)).cache, now)
      if (why) {
        $.ui.toast(`Can't warm: ${why}.`)
        return
      }
      lastPing = null
      await update($, warmUntilAtom, () => now + WARM_FOR_MS)
      $.ui.toast(`Keeping the cache warm: a hidden ping ${WARM_AFTER_MS / 60_000} min after the last reply, for up to 8 hours. Press Stop to end it.`)
    },
    clear: async () => {
      if (isWorking) $.ui.toast('Clear runs once the current turn finishes.')
      try {
        await $.command.run({ command: 'clear' })
      } catch {
        $.ui.toast('Could not run /clear right now.')
      }
    },
    // Queued like Clear: $.session.compact() rejects whenever the engine is not idle.
    // Our session.compact hook resets the cache once it runs.
    compact: async () => {
      if (isWorking) $.ui.toast('Compact runs once the current turn finishes.')
      try {
        await $.command.run({ command: 'compact' })
      } catch (err) {
        $.ui.toast(`Could not run /compact: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}

export const register: Register = on => {
  // â”€â”€ Session lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // One command each: the desktop composer drops anything typed after a slash command's name.
    for (const c of COMMANDS) await $.command.register(c)
    const storedPx = await $.store.get('pxPerCell')
    if (typeof storedPx === 'number' && storedPx > 0) await update($, pxPerCellAtom, () => storedPx)
    const initial = await current($)
    await update($, snapshotAtom, prev => prev ?? initial)
    void refresh($, true)
    // Started from the phone: the pane is how the panel shows there.
    if (await hasMobile($)) void $.ui.open({ id: PANE, title: 'Context & cache' }).catch(() => undefined)
    // The countdown: checked once a second, redrawn only when a figure the
    // panel shows would change (a 60m TTL moves a whole percent every 36s; a
    // 5m one shows seconds, so it redraws every second).
    let lastShown = ''
    $.clock.every(1000, () => {
      void (async () => {
        const [snap, hidden] = await Promise.all([read($, snapshotAtom), read($, hiddenAtom)])
        if (hidden || !snap || snap.cache.lastAt === null) return
        const now = await $.clock.now()
        const c = cacheView(snap.cache, now)
        const shown = `${c.state}|${pct(c.warmth * 100)}|${c.detail}|${c.state === 'cooling' ? noticeText(c, snap.context, snap.cache.ttlMs) : ''}`
        if (shown === lastShown) return
        lastShown = shown
        await update($, nowAtom, () => now)
      })().catch(() => undefined)
    })
    $.clock.every(ACCOUNT_EVERY_MS, () => void refresh($, false))
    $.clock.every(15_000, () => void warmTick($).catch(() => undefined))
    return next(e)
  })

  // Resumed: the transcript says how long ago the last response was.
  on('classic.SessionStart', async ($, e, next) => {
    const now = await $.clock.now()
    if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      await patchCache($, { lastAt: now - e.seconds_since_last_response * 1000 })
    } else if (e.source === 'clear' || e.source === 'compact') {
      await patchCache($, { lastAt: null, hitRate: null })
    }
    void learnTtl($, e.transcript_path)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // Each main-thread response writes/reads the cache as it lands, so a long
  // turn (or the first one after /clear) does not sit at "Empty" until it ends.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r.usage
    if (e.agentId === undefined && u) {
      const total = u.cache_read_input_tokens + u.cache_creation_input_tokens + u.input_tokens
      void $.clock
        .now()
        .then(now => patchCache($, { lastAt: now, hitRate: total > 0 ? u.cache_read_input_tokens / total : null }))
        .catch(() => undefined)
    }
    return r
  })

  // A turn of the main conversation ended: its requests just wrote/read the cache.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      turnNo += 1
      const now = await $.clock.now()
      const u = e.usage
      const total = u ? u.cache_read_input_tokens + u.cache_creation_input_tokens + u.input_tokens : 0
      await patchCache($, {
        lastAt: u ? now : (await current($)).cache.lastAt,
        hitRate: u && total > 0 ? u.cache_read_input_tokens / total : (await current($)).cache.hitRate,
      })
      void refresh($)
    }
    return result
  })

  // You're back: your own message keeps the cache warm from here, so warming stops.
  // turn.start, not prompt.submit: the desktop app's messages skip prompt.submit.
  on('turn.start', async ($, e, next) => {
    if (!warmInFlight && (await read($, warmUntilAtom)) !== null) {
      await update($, warmUntilAtom, () => null)
      $.ui.toast('Welcome back: warming stopped.')
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // After each turn, read which TTL the responses were cached with.
  on('classic.Stop', ($, e, next) => {
    void learnTtl($, e.transcript_path)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // The engine reports the TTL itself on a model switch; a switch also forfeits the cache.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await setTtl($, e.cache_ttl === '5m' ? TTL_5M : TTL_1H)
    await patchCache($, { lastAt: null, hitRate: null })
    void refresh($)
    return next(e)
  }).catch((_$, e, next) => next(e))

  // Usage figures moved (context fill, a limit window).
  on('session.measure', ($, e, next) => {
    void refresh($)
    return next(e)
  })

  // A compaction replaces the conversation: nothing of the new one is cached yet.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger !== 'precompute' && !('skip' in result)) {
      await patchCache($, { lastAt: null, hitRate: null })
      void refresh($)
    }
    return result
  }).catch((_$, e, next) => next(e))

  // /clear starts a fresh conversation in the same process.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      await patchCache($, { lastAt: null, hitRate: null })
      void refresh($)
    }
    return result
  })

  // â”€â”€ /cache, /cache-status, /cache-pane, /cache-refresh, /cache-scale â”€â”€â”€â”€

  on('command.run', { command: 'cache-status' }, async $ => ({ text: await statusReport($) }))

  on('command.run', { command: 'cache-refresh' }, async $ => {
    await refresh($, true)
    return { text: 'Context & cache panel refreshed.' }
  })

  on('command.run', { command: 'cache-scale' }, async ($, e) => {
    const was = await read($, pxPerCellAtom)
    const typed = Number(e.args.trim())
    // No number typed (or none delivered): step through 7 â€¦ 9.5 and round.
    const n = Number.isFinite(typed) && typed > 0 ? typed : was >= 9.5 ? 7 : Math.round((was + 0.5) * 2) / 2
    await $.store.set('pxPerCell', n)
    await update($, pxPerCellAtom, () => n)
    return { text: `Desktop now draws at ${n} px per cell (was ${was}). Run it again to step up; /cache-scale <px> sets it outright.` }
  })

  on('command.run', { command: 'cache-pane' }, async $ => {
    await update($, hiddenAtom, () => false)
    void refresh($)
    await $.ui.open({ id: PANE, title: 'Context & cache' })
    return { text: 'Context & cache panel opened.' }
  })

  on('command.run', { command: 'cache' }, async $ => {
    const isHidden = await read($, hiddenAtom)
    await update($, hiddenAtom, () => !isHidden)
    if (isHidden) {
      void refresh($)
      // Phones have no band above the prompt: show it there as a pane.
      if (await hasMobile($)) await $.ui.open({ id: PANE, title: 'Context & cache' })
      return { text: 'Context & cache panel shown.' }
    }
    await $.ui.close({ id: PANE }).catch(() => undefined)
    return { text: 'Context & cache panel hidden. /cache shows it again.' }
  })

  // A phone joined the session: open the panel as a pane there.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    attached.push(e.surface)
    if (e.surface === 'mobile' && !(await read($, hiddenAtom))) {
      void $.ui.open({ id: PANE, title: 'Context & cache' }).catch(() => undefined)
    }
    return result
  })

  // â”€â”€ The band above the prompt (terminal, desktop) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    noteDraw('AbovePrompt', e.surface)
    if (e.props.hasSurvey) return next(e)
    if (e.props.view.agentId !== undefined) return next(e)
    const E = $.ui.resolve(e)
    if (e.surface === 'terminal') {
      const vm = await panelModel($, e.props.bodyColumns, e.props.maxRows)
      if (!vm) return next(e)
      return renderTerminal(E as Parameters<typeof renderTerminal>[0], vm, e.props.bodyColumns, (await actionsFor($, e.props.isWorking)))
    }
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const px = await widthPx($, e.props.bodyColumns)
      const vm = await panelModel($, designCells(px), e.props.maxRows)
      if (!vm) return next(e)
      return renderDesktop(E as Parameters<typeof renderDesktop>[0], vm, px, (await actionsFor($, e.props.isWorking)))
    }
    return next(e)
  })

  // â”€â”€ The same panel as a pane (every surface; the phone's way to see it) â”€

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    noteDraw('Pane', e.surface)
    const E = $.ui.resolve(e)
    const { Text } = E
    const rows = Math.max(e.props.scroll.bodyRows, 12)
    if (e.surface === 'terminal') {
      const vm = await panelModel($, e.props.bodyColumns, rows)
      if (!vm) return <Text dimColor>Reading usageâ€¦</Text>
      return renderTerminal(E as Parameters<typeof renderTerminal>[0], vm, e.props.bodyColumns, (await actionsFor($, false)))
    }
    const px = await widthPx($, e.props.bodyColumns)
    const vm = await panelModel($, designCells(px), rows)
    if (!vm) return <Text dimColor>Reading usageâ€¦</Text>
    return renderDesktop(E as Parameters<typeof renderDesktop>[0], vm, px, (await actionsFor($, false)))
  })
}
