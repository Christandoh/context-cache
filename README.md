# Context-cache

[![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FChristandoh%2Fcontext-cache%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=555)](.claude-plugin/plugin.json)
[![installs](https://raw.githubusercontent.com/Christandoh/context-cache/traffic/badge.svg)](#installs)
[![stars](https://img.shields.io/github/stars/Christandoh/context-cache?style=flat)](https://github.com/Christandoh/context-cache/stargazers)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)](#install)

A Claude Code mod that puts your context window, your usage limits and your prompt cache on one card above the prompt. It shows in the terminal, in the desktop app's Code tab and, as a pane, on the phone.

![The panel in the desktop app, live data](docs/wide-real.png)

That's a real session. 484k of a 1M context window, the session limit at 34% with 54% of its five hours gone, the weekly and Fable limits, and a prompt cache that is warm with 59 minutes left. The notice at the bottom says what the next message will cost you, with Clear and Compact beside it. This screenshot predates 0.1.5 and still shows a Later button.

## Why

Claude Code already tells you all of this, in three places. `/context` has the window, `/usage` has the limits, and the cache is in the usage figures if you know where to look. None of it is on screen while you work, and the one number that changes what you do next, whether your cache is about to expire, isn't anywhere.

The cache matters more than it looks. Every reply re-sends the whole conversation. With the cache warm, 98% of that is served from memory at a tenth of the price. Let it go cold, by walking away for an hour, and the next message pays full price to re-read everything. The panel counts that down and tells you before it happens.

The limits matter too, and in a particular way. Being at 60% of your weekly allowance is fine on Saturday and a problem on Tuesday. So each limit bar carries two layers. The dark one is how much of the window's time has passed, the bright one is how much you've used, and a white tick marks where time is. If the bright bar is past the tick you're ahead of pace, and the bar turns amber. At 90% it turns red.

## What's on the card

The top row is the context window. Tokens used out of the window, in four groups (System, Tools, Files, Messages) with a legend under the bar and a tick where auto-compact will fire.

The middle row is three limits and the cache. Current session (5 hours), Weekly (7 days) and Fable (the model-specific weekly window), each with the double bar described above, the two percentages and the reset time. Then the cache. Warm, Cooling or Cold, a temperature bar, how warm it is as a percentage of its time-to-live, the last reply's cache hit rate, and minutes left.

The bottom row is a one-line notice about the cache with two buttons. Clear runs `/clear`. Compact compacts the conversation. The row never hides, whatever the cache holds, so the buttons are always there. With nothing cached yet, in a fresh session or after `/clear` or a compaction, it says how much the next message will write to the cache.

![900 px, nothing cached yet](docs/empty-900.png)

## Four widths

The card re-lays itself as the window changes. Columns down to about 500 px, rings below that, and the legend drops at about 360 px. All four were drawn first in a design file and the panel reproduces them to the pixel.

![900 px, a cooling cache](docs/wide-900.png)

![620 px, two limits in the red and an auto-compact warning](docs/medium-620.png)

![420 px, rings](docs/narrow-420.png)

![320 px, a cold cache](docs/phone-320.png)

## Install

```
claude plugin marketplace add Christandoh/context-cache
claude plugin install context-cache@chris-mods
```

Inside a session, `/plugin marketplace add Christandoh/context-cache` and then `/plugin install context-cache@chris-mods` do the same. Installed at the user scope, it loads in every Claude Code session, including the desktop app's Code tab. Start a new session and the card is there.

Installing puts a copy in your plugin cache. `claude plugin update context-cache@chris-mods` fetches a new release whenever `version` in `plugin.json` has changed.

Two limits of the platform worth knowing. The desktop app's ordinary chat has no plugin surface, so the card can't appear there. And the panel's figures for the weekly and Fable limits come from an endpoint Anthropic hasn't documented (`/usage` reads the same one). If that endpoint changes, the Fable column shows "No data" and everything else keeps working.

## Commands

`/cache` hides or shows the card.

`/cache-status` prints a diagnostics report. Which apps are attached, what the mod has drawn, where each figure came from, and how the last account usage request went (auth kind, HTTP status, the windows in the response and which one matched Fable). The full report also lands in `context-cache-status.json` in the session's working directory.

`/cache-pane` opens the card as a pane, on any device.

`/cache-refresh` re-reads usage now instead of waiting for the next poll.

`/cache-scale` sets how many CSS pixels the desktop draws per band cell. The default is 8. `/cache-scale 8.5` sets a value; a bare `/cache-scale` steps it up by a half, from 7 round to 9.5. You only need it if the card comes out narrower or wider than the composer.

These are five separate commands rather than one with arguments because the desktop composer drops anything typed after a slash command's name.

## Where the numbers come from

Every figure has a named source. One is worked out rather than reported: Files is the share of the conversation that is `Read` output, by character count, because Claude Code folds file reads into Messages.

| Figure | Source |
|---|---|
| Context used, window, auto-compact point | `$.session.usage()`, the same figures as the status line and `/context` |
| System / Tools / Messages split | the `/context` breakdown, scaled to the real token count |
| Files | the share of Messages that is `Read` output, by character count |
| Session and weekly limits | the rate-limit headers of every reply, so they move with each message. The headers can trail the account endpoint by a point, so when both describe the same window the panel shows the higher of the two, which matches `/usage` |
| Fable, and any reset time a header lacks | Anthropic's account usage endpoint (`api.anthropic.com/api/oauth/usage`), called through Claude Code with your session's own login, so the mod never sees the token. Asked once at session start, then every 5 minutes, and on `/cache-refresh`. Fable is the `limits[]` item whose scope names Fable, matched by name so a moved key still works |
| Time % | worked out from each window's reset time and its length (5h or 7d) |
| Cache TTL (5m or 60m) | read from the `cache_creation` usage of your last response in the transcript, or from Claude Code's own report when you switch model; remembered across sessions |
| Last cache write | each reply in the main conversation as it arrives, mid-turn included (or, on resume, how long ago the last response was) |
| Hit % | cache reads divided by (cache reads + cache writes + uncached input), for the last reply during a turn and for the whole turn once it ends |

Warmth is remaining TTL divided by TTL. Warm above 25%, Cooling between 1 and 25%, Cold at 0%. A `/clear`, a compaction or a model switch empties the cache, and the card shows "Nothing cached yet" until the first reply of the next turn arrives.

## Working on it

```
git clone https://github.com/Christandoh/context-cache
claude plugin marketplace add ./context-cache
claude plugin install context-cache@chris-mods
```

A warning from experience. `claude plugin list` will say the plugin is read from your folder, but the engine runs a copy under `~/.claude/plugins/cache/chris-mods/context-cache/<version>` taken at install time. Edits to the folder never reach the running mod, and `/reload-plugins` only reloads the stale copy. After editing, refresh the copy:

```
claude plugin uninstall context-cache@chris-mods
claude plugin install context-cache@chris-mods
```

then `/reload-plugins` in an open session. Slash commands register when a session starts, so a brand-new command needs a new session. For a single terminal session, `claude --plugin-dir ./context-cache` skips the install.

Check it with:

```
claude plugin validate .
```

`hooks/register.tsx` holds the hooks: data collection, the commands and the band. `hooks/model.ts` is the maths, thresholds and copy, with no drawing in it. `hooks/view.tsx` draws the terminal version in cells and the desktop version as the SVG panel plus the host's buttons. `hooks/panel-svg.ts` lays the design out as SVG at its real pixel sizes, measuring text with the font widths in `hooks/metrics.ts`. `types/index.d.ts` is the mod's `$.state` contract.

## Licence

MIT. See `LICENSE`.

## Installs

The installs badge and the chart below count clones of this repo. Adding the marketplace clones it, so each install shows up as one. Reinstalls and updates clone it too, so the number runs a little high. Nothing is sent from your machine.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Christandoh/context-cache/traffic/line-dark.svg">
  <img alt="Installs over time" src="https://raw.githubusercontent.com/Christandoh/context-cache/traffic/line-light.svg" width="100%">
</picture>
