// Contract for the context-cache mod: the values it keeps in $.state.

/** The four groups the context bar is split into. */
export type ContextCacheGroup = 'system' | 'tools' | 'files' | 'messages'

/** The live context window, as measured after the last response. */
export type ContextCacheContext = {
  /** Tokens in the window now (the last response's input side, or the local estimate before one). */
  used: number
  /** The model's context window in tokens. */
  window: number
  /** Token count at which auto-compact runs; null when auto-compact is off. */
  autoCompactAt: number | null
  /** Tokens per group, scaled so they sum to `used`. */
  parts: Record<ContextCacheGroup, number>
}

export type ContextCacheLimitKind = 'session' | 'weekly' | 'fable'

/** One usage-limit window. */
export type ContextCacheLimit = {
  kind: ContextCacheLimitKind
  /** Percent of the window used, 0 to 100. */
  usage: number
  /** When the window resets, epoch milliseconds; null when not reported. */
  resetsAt: number | null
  /** The window's length in milliseconds (5h or 7d). */
  windowMs: number
}

/** What is known about the prompt cache. */
export type ContextCacheCache = {
  /** When the main conversation's cache was last written or read (end of the last turn); null when nothing is cached. */
  lastAt: number | null
  /** The cache's time to live in milliseconds (300000 or 3600000). */
  ttlMs: number
  /** True once the TTL was read from a real response or the engine. */
  isTtlKnown: boolean
  /** cache_read ÷ (cache_read + cache_creation + uncached input) of the last turn, 0 to 1. */
  hitRate: number | null
}

export type ContextCacheSnapshot = {
  context: ContextCacheContext | null
  limits: ContextCacheLimit[]
  /** Where the limits came from: the account usage endpoint, the last response's headers, or nowhere. */
  limitsSource: 'account' | 'response' | 'none'
  cache: ContextCacheCache
  /** When this snapshot was taken, epoch milliseconds. */
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-cache': {
      snapshot: ContextCacheSnapshot | null
      /** The cache state the notice was dismissed in; it shows again once the state changes. */
      dismissed: string | null
      isHidden: boolean
      /** The clock, written once a second so the countdown redraws. */
      now: number
      /** Desktop/mobile: CSS px per host cell, to draw the design at its real px size (/cache scale). */
      pxPerCell: number
    }
  }
}
