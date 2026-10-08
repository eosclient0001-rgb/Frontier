#!/usr/bin/env python3
"""Check the native ports against the built bundle itself, not against the source files.

    python3 Exhibits/Workbench/BundleParity.py

Experimental/ProjectZeroEditor/index.html is the reference. It is a built, minified, self-contained
bundle: the React app, the InspectorDepot kit embedded as an escaped JS string, and Editor.css inlined
in a single <style>. Reading the .js and .css sources beside it is not the same thing — a source file
can drift from the build, and twice now the question "which half ships?" has only been answerable from
the bundle.

So this walks the other way round. For each ported surface it pulls the shipped code out of the bundle,
un-escapes it, and asserts that every literal and every numeric constant the native header depends on is
actually present there. A port that drifts from the build fails here.

Exit code 0 and a PASS line on success; the first mismatch raises.
"""
import re
import sys
from pathlib import Path

Root = Path(__file__).resolve().parents[2]
Bundle = Root / 'Experimental/ProjectZeroEditor/index.html'

Checks = 0


def Check(Condition, Claim):
    global Checks
    Checks += 1
    if not Condition:
        raise AssertionError(Claim)


def Unescape(Text):
    """The depot kit is embedded as a JS string inside the bundle, so it is doubly escaped."""
    for Was, Now in (('\\\\u003c', '<'), ('\\u003c', '<'), ('\\\\"', '"'), ('\\"', '"'),
                     ('\\\\n', '\n'), ('\\n', '\n'), ("\\'", "'"),
                     ('\\\\xB7', '\u00b7'), ('\\xB7', '\u00b7'),
                     ('\\\\xD7', '\u00d7'), ('\\xD7', '\u00d7'),
                     ('\\\\u2013', '\u2013'), ('\\u2013', '\u2013'),
                     ('\\\\u2014', '\u2014'), ('\\u2014', '\u2014')):
        Text = Text.replace(Was, Now)
    return Text


def Region(Text, Anchor, Before=130000, After=130000):
    At = Text.find(Anchor)
    Check(At >= 0, f'the bundle contains {Anchor!r}')
    return Text[max(0, At - Before):At + After]


def Native(Relative):
    Path_ = Root / Relative
    Check(Path_.exists(), f'{Relative} exists')
    return Path_.read_text(encoding='utf-8')


def Parity(Name, Shipped, Source, Needles):
    """Every needle must appear in the shipped bundle AND in the native port."""
    for Needle, InNative in Needles:
        Check(Needle in Shipped, f'{Name}: the bundle ships {Needle!r}')
        Check(InNative in Source, f'{Name}: the native port carries {InNative!r} for {Needle!r}')


Raw = Bundle.read_text(encoding='utf-8', errors='replace')
Check(len(Raw) > 4_000_000, 'the reference bundle is the 4.87 MB built file, not a stub')
Loose = Unescape(Raw)

# ---------------------------------------------------------------------------------------------------
# The cloud panel. InspectorHost.js mounts the depot kit for clouds, so the shipped code is the embedded
#    string, not Inspectors.jsx.
# ---------------------------------------------------------------------------------------------------
Clouds = Region(Loose, 'Sun reaching datum')
Port = Native('Engine/Editor/CloudInstrumentSurface.h')
Parity('cloud panel', Clouds, Port, [
    # the four rail pills, in order
    ('W("Coverage")', '"Coverage"'),
    ('W("Optical")',  '"Optical"'),
    ('W("Base")',     '"Base"'),
    ('W("Drift")',    '"Drift"'),
    # the duo
    ('tt("sun","Sun reaching datum")',  'Sun reaching datum'),
    ('tt("cloud","Sky cover")',         'Sky cover'),
    # the coverage card
    ('Condensate threshold \u00b7 cell population', 'Condensate threshold \\xc2\\xb7 cell population'),
    ('Sky fraction', 'Sky fraction'),
    # the deck card
    ('Cloud deck', 'Cloud deck'),
    ('Base altitude \u00b7 optical body', 'Base altitude \\xc2\\xb7 optical body'),
    ('vertical section \u00b7 0\u2013400 m', 'vertical section \\xc2\\xb7 0\\xe2\\x80\\x93'),
    ('label:"Cloud base"',      '"Cloud base"'),
    ('label:"Optical density"', '"Optical density"'),
    ('{t:.289,l:"LOW 130"}',    '"LOW 130"'),
    ('{t:.62,l:"BODY .62"}',    '"BODY .62"'),
    # morphology
    ('Morphology', 'Morphology'),
    ('Cell scale \u00b7 edge detail \u00b7 advection', 'Cell scale \\xc2\\xb7 edge detail \\xc2\\xb7 advection'),
    ('label:"Feature size"', '"Feature size"'),
    ('label:"Edge detail"',  '"Edge detail"'),
    ('label:"Drift speed"',  '"Drift speed"'),
    ('"FOLLOW WIND"', 'FOLLOW WIND'),
    ('sunlit', 'sunlit'),
    ('shadowed', 'shadowed'),
    # the canvases
    ('CLEAR AIR', 'CLEAR AIR'),
    ('CONDENSED', 'CONDENSED'),
    ('km SWATH', 'km SWATH'),
    ('oktas \u00b7 optical depth', 'oktas \\xc2\\xb7 optical depth'),
    ('Advection follows the Wind Field.', 'Advection follows the Wind Field.'),
    ('Layer has independent drift.', 'Layer has independent drift.'),
])

# The maths, which is where an approximation would actually hide.
for Needle, InNative in [
    # the value-noise field: three octaves with their own offsets, over a detail-weighted divisor
    ('Math.max(.2,n)',            'std::max(0.2f, Scale)'),
    ('e*.028*i,t*.028*i)*.55',    '0.028'),
    ('e*.067*i+9,t*.067*i-4)*.3', '0.067'),
    ('e*.16*i-3,t*.16*i+7',       '0.16'),
    ('(.07+r*.08)',               '0.07 + Detail * 0.08'),
    ('(.92+r*.08)',               '0.92 + Detail * 0.08'),
    ('Math.sin(e*127.1+t*311.7)*43758.5453', '127.1'),
    # the threshold and the four names
    ('1-a()*.78',   '0.78f'),
    ('e<.12?"Few":e<.35?"Scattered":e<.65?"Broken":"Overcast"', 'Overcast'),
    # the hero
    ('n?142:170', '170'),
    # the histogram: 1600 probes on a 40-wide lattice, and its inset box
    ('B<1600', '1600'),
    ('B%40*7,Math.floor(B/40)*5', '(I % 40) * 7'),
    ('X=8,K=8,ve=8,Ce=17', '17.0f'),
    # the vertical section: a fixed 0-400 m window, a density-driven body, a scale-driven crest
    ('A-12-K/400*(A-20)', '400.0f'),
    ('X=10+34*s()',       '10.0f + 34.0f * Layer.Density'),
    ('Math.sin(K*.08*m())', '0.08f * Layer.Scale'),
    ('.12*Math.sin(K*.31)', '0.31f'),
    # transmission through the deck
    ('Math.exp(-s()*a()*2.2)', '2.2f'),
]:
    Check(Needle in Clouds, f'cloud maths: the bundle ships {Needle!r}')
    Check(InNative in Port, f'cloud maths: the native port carries {InNative!r} for {Needle!r}')

# ---------------------------------------------------------------------------------------------------
# CloudDeckPanel.jsx. A separate component in a separate place: the React "Cloud base" card, which adapts
#    the band above to the engine's real altitudes. It ships too - this is the check that says so.
# ---------------------------------------------------------------------------------------------------
Deck = Region(Raw, 'cloud-deck-visual', 2500, 1500)
Port = Native('Engine/Editor/CloudDeckSurface.h')
Parity('cloud deck panel', Deck, Port, [
    ('className:"cloud-deck-visual"', 'CloudDeckPanel.jsx'),
    ('"aria-label":"Cloud deck base altitude"', 'the base line is a slider'),
    ('CLOUD DECK \\xB7 VERTICAL SECTION', 'CLOUD DECK \\xc2\\xb7 VERTICAL SECTION'),
    ('"DATUM"', '"DATUM"'),
    ('height:176', '176.0f'),
    ('borderRadius:8', '8.0f'),
    ('"rgba(238,243,248,.05)"', '238.0f'),
    ('`rgba(238,243,248,${.75*u})`', '0.75f * Density'),
    ('`rgba(92,108,128,${.72*u})`', '0.72f * Density'),
    ('"#060708"', 'IM_COL32(  6,   7,   8, 255)'),
    ('"#ffffff12"', 'IM_COL32(255, 255, 255,  18)'),
    ('"#8b9299"', 'IM_COL32(139, 146, 153, 255)'),
    ('"#ffffffaa"', 'IM_COL32(255, 255, 255, 170)'),
    ('"#929a9f"', 'IM_COL32(146, 154, 159, 255)'),
    ('setLineDash([3,3])', '3.0f, 3.0f'),
    ('4.3', '4.3f'),
    ('(b.height-18-(x.clientY-b.top))/(b.height-48)', 'Tall - FootPad - Y'),
])

# ---------------------------------------------------------------------------------------------------
# FracturePanel.jsx. Its CSS is in the bundle's inlined <style>; its markup is in the React chunk.
# ---------------------------------------------------------------------------------------------------
Style = re.search(r'<style[^>]*>(.*?)</style>', Raw, re.S)
Check(Style is not None, 'the bundle inlines a stylesheet')
Sheet = Style.group(1)
Fracture = Region(Raw, 'PER-OBJECT GEOMETRY', 6000, 6000)
Port = Native('Engine/Editor/FractureCardSurface.h')
Parity('fracture card', Fracture, Port, [
    ('PER-OBJECT GEOMETRY', 'PER-OBJECT GEOMETRY'),
    ('Enable fracture', 'Enable fracture'),
    ('Bake SDF per piece', 'Bake SDF per piece'),
    ('Resolution per piece', 'Resolution per piece'),
    ('Generate fragments on demand.', 'Generate fragments on demand.'),
    ('Reuse stored geometry for this object.', 'Reuse stored geometry for this object.'),
    ('Browser bake ready.', 'Browser bake ready.'),
    ('Browser geometry ready. SDF pending.', 'Browser geometry ready. SDF pending.'),
    ('Open the editor to bake or refresh geometry.', 'Open the editor to bake or refresh geometry.'),
    ('Concave preview needs decomposition.', 'Concave preview needs decomposition.'),
    ('Source geometry preview is pending.', 'Source geometry preview is pending.'),
    ('SDF authoring setting', 'SDF authoring setting'),
    ('R16F', 'R16F'),
])
for Needle, InNative in [
    ('.fracture-card h3{font-size:15px', 'TitleSize   = 15.0f'),
    ('.fracture-card header small{font-size:9px', 'EyebrowSize =  9.0f'),
    ('letter-spacing:1.2px', 'EyebrowTrack=  1.2f'),
    ('.fracture-diagram svg{display:block;width:100%;height:134px', 'DiagramTall =134.0f'),
    ('.fracture-mode{display:flex;gap:4px;padding:4px', 'ModePad     =  4.0f'),
    ('background:#0e0e0e', 'IM_COL32( 14,  14,  14, 255)'),
    ('button[aria-pressed=true]{background:#343434', 'IM_COL32( 52,  52,  52, 255)'),
    ('.fracture-sdf{border-top:1px solid #ffffff0a', 'IM_COL32(255, 255, 255,  10)'),
]:
    Flat = re.sub(r'\s+', '', Sheet)
    Check(re.sub(r'\s+', '', Needle) in Flat, f'fracture CSS: the bundle ships {Needle!r}')
    Check(InNative in Port, f'fracture CSS: the native port carries {InNative!r} for {Needle!r}')

# The Voronoi solid, from FractureProjection.js.
Glyph = Region(Raw, 'Shaded fractured solid illustration', 4000, 2000)
for Needle, InNative in [
    ('58', 'GlyphSpan = 58.0'),
    ('133', '133.0'),
    ('.36', '0.36'),
    ('.35', '0.35'),
    ('1.05', '1.05'),
    ('.77', '0.77'),
    ('.18', '0.18'),
    ('.16', '0.16'),
    ('.12', '0.12'),
    ('#d4dfd4', 'IM_COL32(212, 223, 212, 48)'),
]:
    Check(Needle in Glyph, f'fracture solid: the bundle ships {Needle!r}')
    Check(InNative in Port, f'fracture solid: the native port carries {InNative!r}')

# ---------------------------------------------------------------------------------------------------
# EntityNotes. Rendered from the shared Header() for every subject, folders included.
# ---------------------------------------------------------------------------------------------------
Notes = Region(Raw, 'Purpose, ownership, review notes', 4000, 2000)
Port = Native('Engine/Editor/EntityNotesSurface.h')
Parity('entity notes', Notes, Port, [
    ('Add notes', 'Add notes'),
    ('Purpose, ownership, review notes', 'Purpose, ownership, review notes'),
    ('Hide', '"Hide"'),
    ('Optional', 'OPTIONAL'),
    ('entity-notes', 'EntityNotes'),
])
for Needle, InNative in [
    ('.entity-notes-add{min-height:30px', 'AddTall    = 30.0f'),
    ('border:1px dashed #424242', 'IM_COL32( 66,  66,  66, 255)'),
    ('color:#898989', 'IM_COL32(137, 137, 137, 255)'),
    ('.entity-notes-add:hover{color:#d2d2d2;border-color:#676767}', 'IM_COL32(103, 103, 103, 255)'),
    ('.entity-notes{margin-top:10px;padding:10px;border-radius:9px;background:#191919;border:1px solid #303030}',
     'PanelRound =  9.0f'),
    ('.entity-notes strong{color:#c9c9c9;font-size:10px', 'IM_COL32(201, 201, 201, 255)'),
    ('.entity-notes small{color:#6e6e6e;font-size:8px;text-transform:uppercase;letter-spacing:.8px}',
     'AsideTrack =  0.8f'),
    ('.entity-notes button{min-height:22px', 'HideTall   = 22.0f'),
    ('.entity-notes textarea{width:100%;min-height:76px;resize:vertical;border-radius:6px;background:#111;color:#ccc}',
     'FieldTall  = 76.0f'),
    ('.inspector-heading{height:110px', 'HeadShut   = 110.0f'),
    ('.inspector-heading:has(>.entity-notes){height:224px}', 'HeadOpen   = 224.0f'),
    ('.inspector-heading>.entity-notes{position:absolute;top:105px', 'NotesTop   = 105.0f'),
]:
    Flat = re.sub(r'\s+', '', Sheet)
    Check(re.sub(r'\s+', '', Needle) in Flat, f'notes CSS: the bundle ships {Needle!r}')
    Check(InNative in Port, f'notes CSS: the native port carries {InNative!r} for {Needle!r}')

print(f'PASS {Checks} checks: the native cloud, cloud-deck, fracture and notes ports match the built bundle.')
sys.exit(0)
