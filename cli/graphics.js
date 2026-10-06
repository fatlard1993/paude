const ESC = '\x1b';
const IMAGE_ID = 7317;
const CHUNK = 4096;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// A terminal cell is about twice as tall as it is wide; close enough to keep an image's proportions
const CELL_ASPECT = 2;
const CELL_WIDTH_PIXELS = 9;

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico']);

export const showsImages = () =>
	process.env.TERM === 'xterm-kitty' ||
	Boolean(process.env.KITTY_WINDOW_ID) ||
	process.env.TERM === 'xterm-ghostty' ||
	['WezTerm', 'ghostty'].includes(process.env.TERM_PROGRAM);

const isPng = bytes => PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);

// The protocol takes PNG; anything else goes through ImageMagick when it's installed
export const toPng = async bytes => {
	if (isPng(bytes)) return bytes;

	for (const command of [
		['magick', '-', 'png:-'],
		['convert', '-', 'png:-'],
	]) {
		try {
			const child = Bun.spawn(command, { stdin: bytes, stdout: 'pipe', stderr: 'ignore' });
			const png = new Uint8Array(await new Response(child.stdout).arrayBuffer());

			if ((await child.exited) === 0 && isPng(png)) return png;
		} catch {
			// Not installed; try the next name
		}
	}

	return null;
};

export const pngSize = bytes => {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	return { width: view.getUint32(16), height: view.getUint32(20) };
};

export const fitCells = ({ width, height }, maxCols, maxRows) => {
	let cols = Math.min(maxCols, Math.max(1, Math.ceil(width / CELL_WIDTH_PIXELS)));
	let rows = Math.max(1, Math.round((cols * height) / width / CELL_ASPECT));

	if (rows > maxRows) {
		rows = maxRows;
		cols = Math.max(1, Math.round((rows * CELL_ASPECT * width) / height));
	}

	return { cols, rows };
};

export const transmit = png => {
	const data = Buffer.from(png).toString('base64');
	let out = '';

	for (let start = 0; start < data.length; start += CHUNK) {
		const more = start + CHUNK < data.length ? 1 : 0;
		const keys = start === 0 ? `a=t,f=100,i=${IMAGE_ID},q=2,m=${more}` : `m=${more},q=2`;

		out += `${ESC}_G${keys};${data.slice(start, start + CHUNK)}${ESC}\\`;
	}

	return out;
};

// Shows the sent image over the given cells (1-based), replacing wherever it was shown before; the cursor stays put
export const place = ({ x, y, cols, rows }) =>
	`${ESC}7${ESC}[${y};${x}H${ESC}_Ga=p,i=${IMAGE_ID},p=1,c=${cols},r=${rows},C=1,q=2${ESC}\\${ESC}8`;

export const removeImage = () => `${ESC}_Ga=d,d=I,i=${IMAGE_ID},q=2${ESC}\\`;
