// The universe view's sprites, drawn pixel by pixel: each a grid of palette letters, '.' for nothing. 'c' and 's'
// take a color given when it's drawn (a session's, a machine's, a screen's), so one sprite serves every hue.
export const PALETTE = {
	k: '#0b0d12',
	d: '#252c3b',
	m: '#434d61',
	l: '#77829a',
	w: '#c3cad6',
	W: '#ffffff',
	a: '#a9b8ae',
	A: '#77877e',
	g: '#aab2be',
	G: '#7e8796',
	e: '#05070a',
	o: '#b0602a',
	O: '#6e3a1c',
	t: '#2fb39a',
	T: '#1d6e62',
	p: '#7b5bb5',
	P: '#4b3772',
	y: '#f0b43c',
	Y: '#a8741c',
	r: '#d4524a',
	b: '#3f86d6',
	B: '#24508a',
};

// A grey's head, apart from its body so the head can grow with its session's context: the face stays the same size
// while the skull bulges, veins standing out past three quarters full; its collar and chest pip ('s') in its session's
// color and its model's
const HEADS = {
	small: [
		'...kkkkk...',
		'.kkaaaaakk.',
		'kaaaaaaaaak',
		'kaaaaaaaaAk',
		'keWeaaaeWek',
		'keeeeaeeeek',
		'.kaeeaeeAk.',
		'.kaaaaaaAk.',
		'..kaaaaAk..',
		'...kaaAk...',
	],
	big: [
		'....kkkkk....',
		'..kkaaaaakk..',
		'.kaaaaaaaaak.',
		'kaaaaaaaaaaAk',
		'kaaaaaaaaaaAk',
		'kaaaaaaaaaaAk',
		'.kaaaaaaaaAk.',
		'.keWeaaaeWek.',
		'.keeeeaeeeek.',
		'..kaeeaeeAk..',
		'..kaaaaaaAk..',
		'...kaaaaAk...',
		'....kaaAk....',
	],
	huge: [
		'.....kkkkk.....',
		'...kkaaaaakk...',
		'..kaaraaaraak..',
		'.kaarraaarraak.',
		'kaaaaaraaraaaAk',
		'kaaaaaaaaaaaaAk',
		'kaaraaaaaaaraAk',
		'.kaaaaaaaaaaAk.',
		'..kaaaaaaaaAk..',
		'..keWeaaaeWek..',
		'..keeeeaeeeek..',
		'...kaeeaeeAk...',
		'...kaaaaaaAk...',
		'....kaaaaAk....',
		'.....kaaAk.....',
	],
	// About to compact itself: past the biggest, veins all over it; it throbs between this and the huge one
	bursting: [
		'......kkkkk......',
		'....kkaaaaakk....',
		'...kaaraaaraak...',
		'..kaarraaarraak..',
		'.kaaaaaraaraaaAk.',
		'kaaraaaaaaaaaraAk',
		'kaarraaaaaaarraAk',
		'kaaaaraaaaaraaaAk',
		'.kaaaaaaaaaaaaAk.',
		'..kaaaaaaaaaaAk..',
		'...keWeaaaeWek...',
		'...keeeeaeeeek...',
		'....kaeeaeeAk....',
		'....kaaaaaaAk....',
		'.....kaaaaAk.....',
		'......kaaAk......',
	],
};

// Seen from behind: no face, the back of its skull shaded down one side
const back = rows => rows.map(row => row.replaceAll(/[eW]/g, 'a').replaceAll('r', 'a'));

// Its eyes shut: all but the lowest row of each eye go the color of its face, leaving the line of its lids
const shut = rows => {
	const lowest = rows.findLastIndex(row => row.includes('e'));

	return rows.map((row, index) => (index < lowest ? row.replaceAll(/[eW]/g, 'a') : row));
};

const BODIES = {
	stand: ['..kkcccck..', '.kaaaaaaAk.', 'kaksaaaAkAk', 'kakaaaaAkAk', '.kkak.kAkk.', '..kk...kk..'],
	// A foot lifted, the other planted: walking is these by turns with standing between
	stepLeft: ['..kkcccck..', '.kaaaaaaAk.', 'kaksaaaAkAk', 'kakaaaaAkAk', '..kkk.kAkk.', '.......kk..'],
	stepRight: ['..kkcccck..', '.kaaaaaaAk.', 'kaksaaaAkAk', 'kakaaaaAkAk', '.kkak.kkk..', '..kk.......'],
	wave: [
		'.........kk',
		'........kak',
		'.......kak.',
		'..kkcccak..',
		'.kaaaaaak..',
		'kaksaaaAk..',
		'kakaaaaAk..',
		'.kkak.kAkk.',
		'..kk...kk..',
	],
};

// Someone aboard, in a pressure suit: a gold visor under a stripe of their color, a neck ring, shoulders broader than
// the helmet with the arms hanging from them, gloved, and their color in the light on the chest; a step with each boot for walking
// Its helmet, body and arms, over legs standing or walking
const SUIT_TOP = [
	'...kkkkk...',
	'..kwcccwk..',
	'.kwkkkkkwk.',
	'.kwkyyWkwk.',
	'.kwkYyykwk.',
	'.kwwkkkwwk.',
	'..kklllkk..',
	'.kwwwwwwwk.',
	'kwwwwcwwwwk',
	'kwkwwwwwkwk',
	'kwkwwwwwkwk',
	'kwkwlllwkwk',
	'kmk.kkk.kmk',
];

const SUIT = {
	stand: [...SUIT_TOP, '..kwwkwwk..', '..kwwkwwk..', '..kwwkwwk..', '..kwwkwwk..', '..kmmkmmk..', '..kkk.kkk..'],
	// A boot lifted, the other planted, as the greys walk
	stepLeft: [...SUIT_TOP, '..kwwkwwk..', '..kwwkwwk..', '..kwwkwwk..', '..kmmkwwk..', '..kkkkmmk..', '.....kkkk..'],
	stepRight: [...SUIT_TOP, '..kwwkwwk..', '..kwwkwwk..', '..kwwkwwk..', '..kwwkmmk..', '..kmmkkkk..', '..kkkk.....'],
};

// Someone seen from behind, looking in: the back of their helmet striped in their color, their air pack
const SUIT_BACK = [
	'...kkkkk...',
	'..kwcccwk..',
	'.kwwcccwwk.',
	'.kwwwwwwwk.',
	'.kwwwwwwwk.',
	'.kwwwwwwwk.',
	'..kklllkk..',
	'.kmmmmmmmk.',
	'kwmlllllmwk',
	'kwmmmmmmmwk',
	'kwmmmmmmmwk',
	'kwkmmmmmkwk',
	'kmk.kkk.kmk',
	'..kwwkwwk..',
	'..kwwkwwk..',
	'..kwwkwwk..',
	'..kwwkwwk..',
	'..kmmkmmk..',
	'..kkk.kkk..',
];

// A camera on its bracket, its lens to the right and its light (s) red while it's watching
const CAMERA = ['kkkkkkk..', 'kslllllkk', 'kllllllke', 'kmmmmmmkk', '.kkkkkk..', '...kk....', '..kmk....'];

// A lamp on its post: the light at the top in its color
const LAMP = ['..kkk..', '.kccck.', '.kccck.', '..kkk..', '.kmmmk.', 'kmlllmk', 'kmmmmmk', 'kdddddk', 'kkkkkkk'];

// An engine's reactor, its band lit in the engine's color while it works
const CORE = [
	'..kkkkkkkk..',
	'.kllwwwwllk.',
	'kmlllllllllk',
	'kmmmmmmmmmmk',
	'kcccccccccck',
	'kcsccccccsck',
	'kcccccccccck',
	'kmmmmmmmmmmk',
	'kcccccccccck',
	'kcsccccccsck',
	'kcccccccccck',
	'kmmmmmmmmmmk',
	'kddddddddddk',
	'.kkkkkkkkkk.',
];

// Over a worker that needs you: amber with a bang, or blue with a count drawn over it
const ASKING = [
	'.kkkkkkk.',
	'kyyyyyyyk',
	'kyyykyyyk',
	'kyyykyyyk',
	'kyyykyyyk',
	'kyyyyyyyk',
	'kyyykyyyk',
	'kyyyyyyyk',
	'.kkkkkkk.',
	'...kYk...',
	'....k....',
];
const NEWS = [
	'.kkkkkkk.',
	'kbbbbbbbk',
	'kbbbbbbbk',
	'kbbbbbbbk',
	'kbbbbbbbk',
	'kbbbbbbbk',
	'kbbbbbbbk',
	'kbbbbbbbk',
	'.kkkkkkk.',
	'...kBk...',
	'....k....',
];

// A small grey, a subagent its grey sent out; at work its arms are up at the slate it holds
const SMALL_GREY = [
	'.kkkkk.',
	'kaaaaak',
	'keeaeek',
	'kaaaaak',
	'.kaaak.',
	'..kkk..',
	'.kccck.',
	'kacccak',
	'.kc.ck.',
	'.kk.kk.',
];
const SMALL_GREY_WORK = [
	'.kkkkk.',
	'kaaaaak',
	'keeaeek',
	'kaaaaak',
	'.kaaak.',
	'a.kkk.a',
	'kkccckk',
	'.kccck.',
	'.kc.ck.',
	'.kk.kk.',
];
// A fabled session's monitor: a taller grey of another strain, long in the skull and the leg, that stands behind the
// session's grey and follows its run; its collar in the session's color and its chest pip Fable's
const WATCHER = [
	'....kkk....',
	'...kgggk...',
	'..kgggggk..',
	'..kgggggk..',
	'..kgggggk..',
	'..kgggggk..',
	'..kgggggk..',
	'.kgggggggk.',
	'.kgggggggk.',
	'.kWegggeWk.',
	'.keegggeek.',
	'..kegggek..',
	'..kgggggk..',
	'...kgggk...',
	'....kgk....',
	'....kgk....',
	'..kkcccck..',
	'.kgggggggk.',
	'kgksgggGkGk',
	'kgkggggGkGk',
	'kgkggggGkGk',
	'.kkgk.kGkk.',
	'..kgk.kGk..',
	'..kgk.kGk..',
	'..kgk.kGk..',
	'..kgk.kGk..',
	'..kgk.kGk..',
	'..kgk.kGk..',
	'..kgk.kGk..',
	'..kk...kk..',
];
// Pointing: its near arm off its side, drawn out toward what it points at by whoever draws it
const WATCHER_POINT = WATCHER.map((row, index) => (index >= 18 && index <= 21 ? `..${row.slice(2)}` : row));
const PAPER = ['kkkkkkk', 'kwwwwwk', 'klllllk', 'kkkkkkk'];
const CRATE = ['kkkkkkkk', 'koooooOk', 'kokkkkOk', 'koOooOOk', 'kokkkkOk', 'kOOOOOOk', 'kkkkkkkk'];
const CANISTER = ['.kkk.', 'kccck', 'kcWck', 'kccck', 'kccck', '.kkk.'];

// What stands in a bay's back corner: a potted plant, a locker with its stripe in the project's color, a rack of
// drives blinking
const PLANT = [
	'..G.g...',
	'.gGgG.g.',
	'gGgGgGg.',
	'.GgGgGgG',
	'gGgTgGg.',
	'.gTgTg..',
	'..kTk...',
	'.kooOk..',
	'.koOOk..',
	'.kOOOk..',
	'..kkk...',
].map(row => row.replaceAll('g', 't').replaceAll('G', 'T'));
const LOCKER = [
	'kkkkkkkkk',
	'kllllwlmk',
	'klmmkmmmk',
	'klmmkmmmk',
	'kccckccck',
	'klmmkmmmk',
	'klwmkmwmk',
	'klmmkmmmk',
	'klmmkmmmk',
	'klmmkmmmk',
	'kdddkdddk',
	'kkkkkkkkk',
];
const RACK = [
	'kkkkkkkkk',
	'kmlllllmk',
	'kdsdkdddk',
	'kmmmmmmmk',
	'kdddksdsk',
	'kmmmmmmmk',
	'kdsdkdddk',
	'kmmmmmmmk',
	'kddskdddk',
	'kmmmmmmmk',
	'kdddddddk',
	'kkk...kkk',
];

// A filing cabinet, its drawer pulls in the project's color; and a plant grown tall in a big pot
const CABINET = [
	'kkkkkkkk',
	'kwllllmk',
	'kmmccmmk',
	'kddddddk',
	'klllllmk',
	'kmmccmmk',
	'kddddddk',
	'klllllmk',
	'kmmccmmk',
	'kddddddk',
	'kkkkkkkk',
];
const TALL_PLANT = [
	'...t.T....',
	'..tTt.t.T.',
	'.tTtTtTtT.',
	'tTtTtTtTtT',
	'.TtTtTtTt.',
	'..TtTtTt..',
	'.tTtTtTtT.',
	'tTtTtTtTt.',
	'.tTtTTtT..',
	'...tTTt...',
	'....TT....',
	'....kT....',
	'..kooOOk..',
	'..koOOOk..',
	'..kOOOOk..',
	'...kkkk...',
];

// The lounge's vending machine, its window of snacks and its lit panel; and a water cooler
const VENDING = [
	'kkkkkkkkkk',
	'krrrrrrrrk',
	'kkkkkkkkkk',
	'kbbbbbbkmk',
	'kbybobkkwk',
	'kbbbbbbkmk',
	'kbtbybkkmk',
	'kbbbbbbkmk',
	'kbobtbkkmk',
	'kbbbbbbkmk',
	'kkkkkkkkmk',
	'kmmmmmmkmk',
	'kmkkkkmkmk',
	'kmmmmmmkmk',
	'kddddddddk',
	'kkkkkkkkkk',
];
const COOLER = [
	'.kkkk.',
	'kbbBBk',
	'kbWbBk',
	'kbbbBk',
	'.kkkk.',
	'kwwwwk',
	'kwkkwk',
	'kwwwwk',
	'kwwwwk',
	'kllllk',
	'kllllk',
	'kmmmmk',
	'kkkkkk',
];

const SPRITES = {
	suitBack: SUIT_BACK,
	camera: CAMERA,
	vending: VENDING,
	cooler: COOLER,
	cabinet: CABINET,
	tallPlant: TALL_PLANT,
	plant: PLANT,
	locker: LOCKER,
	rack: RACK,
	...Object.fromEntries(
		Object.entries(HEADS).flatMap(([size, rows]) => [
			[`head-${size}`, rows],
			[`head-${size}-shut`, shut(rows)],
			[`head-${size}-back`, back(rows)],
		]),
	),
	body: BODIES.stand,
	bodyWave: BODIES.wave,
	bodyStepLeft: BODIES.stepLeft,
	bodyStepRight: BODIES.stepRight,
	bodyBack: BODIES.stand.map(row => row.replace('s', 'a')),
	suit: SUIT.stand,
	suitStepLeft: SUIT.stepLeft,
	suitStepRight: SUIT.stepRight,
	lamp: LAMP,
	core: CORE,
	asking: ASKING,
	news: NEWS,
	smallGrey: SMALL_GREY,
	smallGreyWork: SMALL_GREY_WORK,
	watcher: WATCHER,
	watcherPoint: WATCHER_POINT,
	paper: PAPER,
	crate: CRATE,
	canister: CANISTER,
};

const cache = new Map();

// A sprite as an image, its runtime colors filled in, made once for each set of them
const imageOf = (name, colors) => {
	// By every color it's given: a skull flushed red ('r') is another image from the same one pale
	const key = `${name}|${Object.entries(colors)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([letter, color]) => `${letter}:${color}`)
		.join(',')}`;
	const known = cache.get(key);

	if (known) return known;

	const rows = SPRITES[name];
	const canvas = document.createElement('canvas');

	canvas.width = Math.max(...rows.map(row => row.length));
	canvas.height = rows.length;

	const ctx = canvas.getContext('2d');

	rows.forEach((row, y) =>
		[...row].forEach((letter, x) => {
			const color = { ...PALETTE, ...colors }[letter];

			if (!color || letter === '.') return;
			ctx.fillStyle = color;
			ctx.fillRect(x, y, 1, 1);
		}),
	);
	cache.set(key, canvas);

	return canvas;
};

export const spriteSize = name => ({ w: Math.max(...SPRITES[name].map(row => row.length)), h: SPRITES[name].length });

// A sprite with its feet (bottom middle) at (x, y), in art pixels; `flip` mirrors it
export const drawSprite = (ctx, name, x, y, { colors = {}, flip = false } = {}) => {
	const image = imageOf(name, colors);
	const left = Math.round(x - image.width / 2);
	const top = Math.round(y - image.height);

	if (!flip) return ctx.drawImage(image, left, top);

	ctx.save();
	ctx.translate(left + image.width, top);
	ctx.scale(-1, 1);
	ctx.drawImage(image, 0, 0);
	ctx.restore();
};
