import symbolsFont from '../fonts/SymbolsNerdFontMono-Regular.woff2';

const touch = window.matchMedia('(pointer: coarse)').matches;

// Nerd Font icons (a prompt's git branch, ls with icons) sit in the private use areas, which no ordinary font draws.
// Nerd Fonts' own symbols font covers them, downloaded only once a terminal prints one.
const SYMBOLS_FAMILY = 'Symbols Nerd Font Mono';
const symbols = new FontFace(SYMBOLS_FAMILY, `url(${symbolsFont})`, { unicodeRange: 'U+E000-F8FF, U+F0000-FFFFD' });

document.fonts.add(symbols);

const PRIVATE_USE = /[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]/u;

// Browsers don't fetch a font for text a terminal draws, so output that needs the icons asks for them
export const loadSymbolsFor = text => {
	if (symbols.status === 'unloaded' && PRIVATE_USE.test(text)) symbols.load().catch(() => {});
};

// A terminal drawn on a canvas keeps the boxes it drew before the font arrived, until told to draw again
export const redrawWhenSymbolsLoad = terminal =>
	symbols.loaded
		.then(() => {
			terminal.clearTextureAtlas();
			terminal.refresh(0, terminal.rows - 1);
		})
		.catch(() => {});

// What every terminal on the page shares. Links in the output (OSC 8) open only on the web; xterm's default would
// follow javascript: as paude.
const xtermOptions = {
	// First, because its unicode-range keeps it to the icons: later in the list, a font substituted for a missing
	// name would claim them as empty boxes before the browser got this far
	fontFamily: `"${SYMBOLS_FAMILY}", ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", Menlo, monospace`,
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
