const ESC = '\x1b';
const IMAGE_ID = 7317;
const CHUNK = 4096;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// A terminal cell is about twice as tall as it is wide; close enough to keep an image's proportions
const CELL_ASPECT = 2;
const CELL_WIDTH_PIXELS = 9;

// SVG isn't here: rendering it can reach outside the file, so it opens in the browser, which sandboxes it
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico']);

export const showsImages = () =>
	process.env.TERM === 'xterm-kitty' ||
	Boolean(process.env.KITTY_WINDOW_ID) ||
	process.env.TERM === 'xterm-ghostty' ||
	['WezTerm', 'ghostty'].includes(process.env.TERM_PROGRAM);

const isPng = bytes => PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);

const startsWith = (bytes, signature, offset = 0) =>
	signature.every((byte, index) => byte === null || bytes[offset + index] === byte);

// The format a file's own bytes say it is, as ImageMagick names its decoder; null for anything else. The decoder is
// named outright so ImageMagick never guesses one from the content of a file someone else wrote.
const bitmapDecoder = bytes => {
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
	if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
	if (startsWith(bytes, [0x42, 0x4d])) return 'bmp';
	if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'ico';
	if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69], 4)) return 'avif';

	return null;
};

// The protocol takes PNG; the common bitmap formats go through ImageMagick when it's installed
export const toPng = async bytes => {
	if (isPng(bytes)) return bytes;

	const decoder = bitmapDecoder(bytes);

	if (!decoder) return null;

	for (const command of [
		['magick', `${decoder}:-`, 'png:-'],
		['convert', `${decoder}:-`, 'png:-'],
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
