const touch = window.matchMedia('(pointer: coarse)').matches;

// What every terminal on the page shares. Links in the output (OSC 8) open only on the web; xterm's default would
// follow javascript: as paude.
const xtermOptions = {
	fontFamily: 'ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", Menlo, monospace',
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
