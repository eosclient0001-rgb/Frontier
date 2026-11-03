//============================================================================================================================================
//                                                            GLYPHMARKUP.JS
//============================================================================================================================================
// 🧩 The retained editor glyph set as HTML markup strings, for the prototype's string-built inspector.

// 📝 EditorIcons.js builds a DOM element (the retained exhibit inserts nodes directly). The vehicle inspector composes its cards
//    as markup strings and assigns them in one go, so it needs the same paths as a string. The glyph table itself is not
//    duplicated: this module reads EditorGlyphs and wraps one entry. Source and licence: see EditorIcons.js (lucide, ISC).

import { EditorGlyphs } from './EditorIcons.js';

const StrokeWidth = 1.6;

export function GlyphMarkup(Name, Size = 16, Stroke = StrokeWidth)
{
    const Paths = EditorGlyphs[Name] || '';
    return `<span class="glyph"><svg xmlns="http://www.w3.org/2000/svg" width="${Size}" height="${Size}" viewBox="0 0 24 24" `
         + `fill="none" stroke="currentColor" stroke-width="${Stroke}" stroke-linecap="round" stroke-linejoin="round" `
         + `aria-hidden="true">${Paths}</svg></span>`;
}
