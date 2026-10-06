# context-cache

A Claude Code mod that adds a panel above the prompt, in the terminal and in the desktop app's Code tab. On the Claude mobile app, which has no room above the prompt for mods, the same panel opens as a pane.

The top row is the context window. Tokens used out of the window, split into System, Tools, Files and Messages, with a tick where auto-compact will fire.

Under it, three limits. Current session (5h), Weekly and Fable each get a double bar. The dark layer is how much of the window's time has passed, the bright layer how much of the allowance you have used, and a white tick marks the time position, so you can see at a glance whether you are ahead of pace. The bar turns amber when usage runs well ahead of time and red at 90%.

Beside them, the prompt cache. Warm, Cooling or Cold, a temperature bar, the warmth percentage, the last turn's hit rate and a countdown to expiry.

The bottom row is a one-line notice about the cache with three buttons. Clear runs `/clear`, Compact compacts the conversation, Later hides the notice until the cache changes state.

## Commands

`/cache` hides or shows the panel. Showing it again also brings back a notice you dismissed with Later.

`/cache-status` prints a diagnostics report. Which apps are attached, what the mod has drawn, where each figure came from, and how the last account usage request went (auth kind, HTTP status, the windows in the response and which one matched Fable). The full report also lands in `context-cache-status.json` in the session's working directory.

`/cache-pane` opens the panel as a pane, on any device.

`/cache-refresh` re-reads usage now instead of waiting for the next poll.

`/cache-scale` sets how many CSS pixels the desktop draws per band cell. The default is 8. `/cache-scale 8.5` sets a value; a bare `/cache-scale` steps it up by a half, from 7 round to 9.5. You only need it if the card comes out narrower or wider than the composer.

These are five separate commands rather than one with arguments because the desktop composer drops anything typed after a slash command's name.

On the desktop, in the editor and on the phone the panel is one SVG at the design's pixel sizes (`hooks/panel-svg.ts`), with the host's own buttons for Clear / Compact / Later; the terminal draws it in cells. The band exists in Claude Code only (terminal, the desktop app's Code tab, VS Code, the mobile app's Code sessions). The desktop app's ordinary chat has no plugin surface, so the panel cannot appear there.

On a phone the pane opens by itself, whether you open an existing session there or start one from the phone, and `/cache` opens it too. The phone gets the narrow ring layout.

## Where the numbers come from

| Figure | Source |
|---|---|
| Context used, window, auto-compact point | `$.session.usage()`, the same figures as the status line and `/context` |
| System / Tools / Messages split | the `/context` breakdown, scaled to the real token count |
| Files | the share of Messages that is file contents read by the `Read` tool |
| Session, weekly and Fable limits | Anthropic's account usage endpoint (`api.anthropic.com/api/oauth/usage`, the source `/usage` uses), called with your session's own login through Claude Code; the mod never sees the token. It is asked once at session start, then every 5 minutes, and on `/cache-refresh`; more often and it answers 429. Fable is the `limits[]` item whose scope names Fable, matched by name so a moved key still works. The session and weekly figures themselves come from the rate-limit headers of every reply, which are fresher; the account reading supplies Fable and any reset time a header lacks, and stands in for all three if the headers are missing |
| Time % | worked out from each window's reset time and its length (5h or 7d) |
| Cache TTL (5m or 60m) | read from the `cache_creation` usage of your last response in the transcript, or from Claude Code's own report when you switch model; remembered across sessions |
| Last cache write | the end of the last main-conversation turn (or, on resume, how long ago the last response was) |
| Hit % | the last turn's cache reads ÷ (cache reads + cache writes + uncached input) |

The Fable column (and, between polls, the session and weekly ones) comes from an endpoint Anthropic has not documented; `/usage` reads the same one. If it changes, that column shows "No data" and everything else keeps working.

Warmth = remaining TTL ÷ TTL. Warm above 25%, Cooling between 1 and 25%, Cold at 0%. A `/clear`, a compaction or a model switch empties the cache, and the panel shows "Nothing cached yet" until the next response.

## Install

This folder is both the plugin and a one-plugin marketplace (`.claude-plugin/marketplace.json` lists it with `source: "./"`), which is the layout Claude Code's docs give for hosting a plugin on GitHub.

**From GitHub (for everyone).**

```
claude plugin marketplace add Christandoh/context-cache
claude plugin install context-cache@chris-mods
```

Inside a session, `/plugin marketplace add Christandoh/context-cache` and then `/plugin install context-cache@chris-mods` do the same. Installed at the user scope, it loads in every Claude Code session, including the desktop app's Code tab.

Installing from GitHub puts a copy in your plugin cache. `claude plugin update context-cache@chris-mods` fetches a new release whenever `version` in `plugin.json` has changed, which is why every published change bumps the version.

**From a clone (for working on it).**

```
claude plugin marketplace add /path/to/context-cache
claude plugin install context-cache@chris-mods
```

A warning from experience. `claude plugin list` will say the plugin is read from your folder, but the engine runs a copy under `~/.claude/plugins/cache/chris-mods/context-cache/<version>` taken at install time. Edits to the folder never reach the running mod, and `/reload-plugins` only reloads the stale copy. After editing, refresh the copy:

```
claude plugin uninstall context-cache@chris-mods
claude plugin install context-cache@chris-mods
```

then `/reload-plugins` in an open session. Slash commands register when a session starts, so a brand-new command needs a new session.

**For one terminal session only.**

```
claude --plugin-dir /path/to/context-cache
```

## Develop

```
claude plugin validate .
claude plugin test .
```

`tests/scenarios.test.tsx` feeds the four design scenarios in through the real engine calls (`session.usage`, the usage endpoint, `turn.complete`, a resumed session) and checks each at 900, 620, 420 and 320 px on the terminal and the desktop, plus the Clear, Compact and Later buttons.

`tests/edges.test.tsx` covers what goes wrong in practice. Nothing read yet, a 429 from the account endpoint, a window past 100%, a missing reset time, a 5-minute TTL, bands 20 and 400 cells wide, and every SVG staying well formed and under the host's 128 KB limit.

69 tests in all.

## Files

`hooks/register.tsx` holds the hooks: data collection, the commands and the band. `hooks/model.ts` is the maths, thresholds and copy, with no drawing in it. `hooks/view.tsx` draws the terminal version in cells and the desktop version as the SVG panel plus the host's buttons. `hooks/panel-svg.ts` lays the design out as SVG at its real pixel sizes, measuring text with the font widths in `hooks/metrics.ts`. `types/index.d.ts` is the mod's `$.state` contract.

## Licence

MIT. See `LICENSE`.
