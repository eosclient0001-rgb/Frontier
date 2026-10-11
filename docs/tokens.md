# Design tokens

The interface is built from the Frontier editor's visual language: neutral graphite surfaces,
colour used only as a semantic accent on an icon or an active state, DM Sans throughout. The
viewport is the only thing in the app with real colour in it, and the chrome is deliberately
desaturated so that stays true.

## Palette

| token | value | used for |
| --- | --- | --- |
| `--bg` | `#101010` | app background |
| `--rail` | `#161616` | left object rail |
| `--side` | `#141414` | right stack + inspector column |
| `--stage` | `#0b0b0b` | viewport surround |
| `--line` | `#262626` | 1px structural borders |
| `--line-soft` | `#202020` | dividers inside cards |
| `--control` | `#1d1d1d` | inputs, selects |
| `--control-hi` | `#232323` | input hover |
| `--card-a` → `--card-b` | `#222222` → `#1f1f1f` | card gradient at 125° |
| `--card-line` | `#2f2f2f` | card border |
| `--text` | `#dcdcdc` | body copy |
| `--dim` | `#7d7d7d` | secondary labels |
| `--faint` | `#636363` | hints, units |
| `--accent` | `#cfcfcf` | active state, slider fill, icons |

Each terrain operator also carries its own accent, used on the layer swatch and the inspector icon
only — never as a fill behind text:

| operator | accent | | operator | accent |
| --- | --- | --- | --- | --- |
| Fractal Terrain | `#d6a078` | | Snow | `#cfe0ea` |
| Hydraulic Erosion | `#7fb6cf` | | Levels | `#a89b8a` |
| Thermal | `#c2a06a` | | Plateau | `#9aa98c` |
| River | `#6fa4c4` | | Volcano | `#d08a62` |
| Sediment | `#b5a07e` | | Island | `#7fb8a6` |
| Warp | `#a68cc0` | | Cliff | `#a89a8e` |
| Terrace | `#c9a86a` | | Smooth | `#8fa8c4` |
| Detail | `#b8b0a4` | | Sharpen | `#c4a0a0` |

## Geometry

| element | size |
| --- | --- |
| rail | 246px (224 under 1500px, 200 under 1180px) |
| side column | 382px (348 / 320 at the same breakpoints) |
| layer row | 40px, 8px radius, 3px gap |
| inspector card | 15px radius, 15px padding, 11px gap |
| inspector head icon | 42px, 13px radius |
| toggle | 29 × 17, 30 radius, 11px knob, `translateX(12px)` when on |
| slider track | 3px, 9px thumb with a 3px `#1f1f1f` ring |
| select / input | 30px, 8px radius |
| side tab | 45px with a 2px active underline inset 16% |
| splitter | 6px |

## Type

DM Sans, 400 weight, 13px base.

| style | size | tracking | colour |
| --- | --- | --- | --- |
| brand | 23px | −1.1px | `#dcdcdc` |
| inspector title | 19px | −0.6px | `#eaeaea` |
| metric | 34px | −1.6px, tabular | `#e4e4e4` |
| card head | 11.5px | — | `#c7c7c7` |
| field label | 10.5px | — | `#a4a4a4` |
| eyebrow | 8.5px uppercase | 1.6px | `#828282` |
| hint | 9.5px | — | `#636363` |
| stat | 10px | — | `#8d8d8d` |

## Behaviour

- `:focus-visible` → 2px `#9a9a9a` outline at 2px offset. Never remove it.
- Transitions are short and linear: 200ms for the toggle knob, 120ms for the build bar fill,
  250ms for the build bar appearing.
- Hover states move one step lighter, never to accent colour.
- The inspector backdrop is `radial-gradient(ellipse at 85% 0%, #1a1a1a, #161616 45%, #131313)`,
  which is what stops a long scroll of cards from reading as a flat grey wall.
