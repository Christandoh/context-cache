# Draws the README installs graphics. Run by .github/workflows/installs.yml on the traffic branch:
#   python3 installs_chart.py new.json
# new.json is GitHub's /traffic/clones response (the last 14 days). It is merged into clones.json
# (date -> clones, the whole history), then badge.svg and line-{light,dark}.svg are written next to it. Standard library only.
import datetime as dt, json, os, sys

THEMES = {
    'dark':  dict(bg='#1f1f1e', border='#3a3a38', ink='#ecebe8', ink2='#9a9893', grid='#2e2e2c', mark='#43a462'),
    'light': dict(bg='#ffffff', border='#d0d7de', ink='#1f2328', ink2='#59636e', grid='#eaeef2', mark='#1a7f37'),
}
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
fmt = lambda n: f'{n:,}'
day = lambda d: f'{d.day} {d:%b}'


def load(new_path, now):
    hist = json.load(open('clones.json')) if os.path.exists('clones.json') else {}
    # Days still inside GitHub's 14-day window are overwritten (today's count grows), older days are kept.
    for c in json.load(open(new_path)).get('clones', []):
        hist[c['timestamp'][:10]] = c['count']
    json.dump(dict(sorted(hist.items())), open('clones.json', 'w'), indent=1)
    today = now.date()
    # Start a day before the first clone so the line starts at zero and there are always two points.
    # GitHub also reports zero days from before the repo existed, so those don't count as a start.
    start = min([dt.date.fromisoformat(k) for k, v in hist.items() if v] + [today]) - dt.timedelta(days=1)
    days = [start + dt.timedelta(days=i) for i in range((today - start).days + 1)]
    daily = [hist.get(d.isoformat(), 0) for d in days]
    cum, t = [], 0
    for v in daily:
        t += v; cum.append(t)
    return days, daily, cum


def card(w, h, c, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}">'
            f'<rect x=".5" y=".5" width="{w-1}" height="{h-1}" rx="12" fill="{c["bg"]}" stroke="{c["border"]}"/>{body}</svg>')


def bar(x, y, w, h, fill):  # 4px rounded top, square on the baseline
    if h <= 0: return ''
    r = min(4, w / 2, h)
    return (f'<path d="M{x:.1f},{y+h:.1f} V{y+r:.1f} Q{x:.1f},{y:.1f} {x+r:.1f},{y:.1f} H{x+w-r:.1f} '
            f'Q{x+w:.1f},{y:.1f} {x+w:.1f},{y+r:.1f} V{y+h:.1f} Z" fill="{fill}"/>')


def nice(v):  # smallest 1/2/2.5/5 x 10^e step whose three steps cover v
    for e in range(10):
        for m in (1, 2, 2.5, 5):
            if m * 10**e * 3 >= v: return m * 10**e * 3


def badge(cum):
    val = fmt(cum[-1])
    lw, vw, sw = 49, 7 * len(val) + 10, 46
    w = lw + vw + sw
    pts = cum[-30:]; lo, hi = pts[0], pts[-1]
    step = (sw - 8) / max(len(pts) - 1, 1)
    line = ' '.join(f'{lw+vw+4+i*step:.1f},{16-(v-lo)/(hi-lo or 1)*12:.1f}' for i, v in enumerate(pts))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="20" role="img" aria-label="installs: {val}"><title>installs: {val}</title>'
            f'<clipPath id="r"><rect width="{w}" height="20" rx="3"/></clipPath>'
            f'<g clip-path="url(#r)"><rect width="{lw}" height="20" fill="#555"/><rect x="{lw}" width="{vw+sw}" height="20" fill="#2ea44f"/></g>'
            f'<g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="6" y="14">installs</text><text x="{lw+5}" y="14">{val}</text></g>'
            f'<polyline points="{line}" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>')


def line(c, days, cum):
    x0, x1, y0, y1 = 64, 790, 60, 236
    hi, n = nice(cum[-1]), len(cum)
    X = lambda i: x0 + (x1 - x0) * i / (n - 1)
    Y = lambda v: y1 - (y1 - y0) * v / hi
    pts = ' '.join(f'{X(i):.1f},{Y(v):.1f}' for i, v in enumerate(cum))
    s = (f'<text x="24" y="36" font-size="15" font-weight="600" fill="{c["ink"]}">Installs over time</text>'
         f'<text x="806" y="36" font-size="13" text-anchor="end" fill="{c["ink2"]}">{fmt(cum[-1])} total</text>')
    for k in range(4):
        y = y1 - (y1 - y0) * k / 3
        s += (f'<line x1="{x0}" y1="{y:.1f}" x2="{x1}" y2="{y:.1f}" stroke="{c["grid"] if k else c["border"]}"/>'
              f'<text x="{x0-8}" y="{y+4:.1f}" font-size="11" text-anchor="end" fill="{c["ink2"]}">{fmt(round(hi*k/3))}</text>')
    s += (f'<polygon points="{x0},{y1} {pts} {x1},{y1}" fill="{c["mark"]}" fill-opacity=".14"/>'
          f'<polyline points="{pts}" fill="none" stroke="{c["mark"]}" stroke-width="2" stroke-linejoin="round"/>'
          f'<circle cx="{X(n-1):.1f}" cy="{Y(cum[-1]):.1f}" r="5" fill="{c["mark"]}" stroke="{c["bg"]}" stroke-width="2"/>')
    for i in sorted({round(k * (n - 1) / 4) for k in range(5)}):  # up to five dates along the bottom
        anchor = 'start' if i == 0 else 'end' if i == n - 1 else 'middle'
        s += f'<text x="{X(i):.1f}" y="256" font-size="11" text-anchor="{anchor}" fill="{c["ink2"]}">{day(days[i])}</text>'
    return card(830, 280, c, s)


if __name__ == '__main__':
    now = dt.datetime.now(dt.timezone.utc)
    days, daily, cum = load(sys.argv[1], now)
    out = {'badge.svg': badge(cum)}
    for t, c in THEMES.items():
        out[f'line-{t}.svg'] = line(c, days, cum)
    for name, svg in out.items():
        open(name, 'w', encoding='utf-8').write(svg)
    print(f'installs {cum[-1]}, this week {sum(daily[-7:])}, today {daily[-1]}')
