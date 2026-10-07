import symbolsFont from '../fonts/SymbolsNerdFontMono-Regular.woff2';
import technicalFont from '../fonts/FreeMonoTechnical.woff2';

const touch = window.matchMedia('(pointer: coarse)').matches;

// Fonts for what ordinary monospace fonts leave as boxes, each downloaded only once a terminal prints something it
// draws. Nerd Font icons (a prompt's git branch, ls with icons) sit in the private use areas; Nerd Fonts' own symbols
// font covers them. Claude Code's marks (⏵⏵ before the mode, ⏸, ⎿ under a tool call, ⧉) are technical and math
// symbols phones lack; a cut of GNU FreeMono covers those, at the terminal's own width.
const SYMBOL_FONTS = [
	{
		face: new FontFace('Symbols Nerd Font Mono', `url(${symbolsFont})`, { unicodeRange: 'U+E000-F8FF, U+F0000-FFFFD' }),
		needed: /[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]/u,
	},
	{
		face: new FontFace('FreeMono Technical', `url(${technicalFont})`, { unicodeRange: 'U+2300-23FF, U+2980-29FF' }),
		needed: /[\u2300-\u23FF\u2980-\u29FF]/u,
	},
];

for (const { face } of SYMBOL_FONTS) document.fonts.add(face);

// Browsers don't fetch a font for text a terminal draws, so output that needs one asks for it
export const loadSymbolsFor = text => {
	for (const { face, needed } of SYMBOL_FONTS)
		if (face.status === 'unloaded' && needed.test(text)) face.load().catch(() => {});
};

// A terminal drawn on a canvas keeps the boxes it drew before a font arrived, until told to draw again
export const redrawWhenSymbolsLoad = terminal => {
	for (const { face } of SYMBOL_FONTS)
		face.loaded
			.then(() => {
				terminal.clearTextureAtlas();
				terminal.refresh(0, terminal.rows - 1);
			})
			.catch(() => {});
};

// What every terminal on the page shares. Links in the output (OSC 8) open only on the web; xterm's default would
// follow javascript: as paude.
const xtermOptions = {
	// First, because their unicode-ranges keep them to their symbols: later in the list, a font substituted for a missing
	// name would claim those as empty boxes before the browser got this far
	fontFamily: `${SYMBOL_FONTS.map(({ face }) => `"${face.family}"`).join(', ')}, ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", Menlo, monospace`,
	fontSize: touch ? 12 : 14,
	lineHeight: 1.15,
	cursorBlink: true,
	allowProposedApi: true,
	linkHandler: {
		activate: (event, uri) => {
			if (/^https?:\/\//i.test(uri)) window.open(uri, '_blank', 'noopener,noreferrer');
		},
	},
};

export default xtermOptions;
