// The universe view's sprites, drawn pixel by pixel: each a grid of palette letters, '.' for nothing. 'c' and 's'
// take a color given when it's drawn (a session's, a machine's, a screen's), so one sprite serves every hue.
// The hull's plating in the ship's color: a grey leaning its way, `lightness` in percent; everything built of the hull's
// skin (its fins, keel, doors, the housings grown out of it) is painted with it
export const plating = (hue, lightness) => `hsl(${hue} 9% ${lightness}%)`;

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

// Sat cross-legged on the floor: the same from the shoulders down to the hands, over a lap with the knees out to
// either side and the shins crossed before it
const SIT_BASE = ['kkaaaaaaaaAkk', 'kaaAkaaaakaAk', '.kkkkkkkkkkk.'];
const sat = rows => [...rows.slice(0, -2).map(row => `.${row}.`), ...SIT_BASE];

Object.assign(BODIES, { sit: sat(BODIES.stand), sitWave: sat(BODIES.wave) });

// Someone aboard, in a pressure suit: a gold visor under a stripe of their color, a neck ring, shoulders broader than
// the helmet with the arms hanging from them, gloved, and a band of their color across the chest; a step with each boot
// for walking
// Its helmet, body and arms, over legs standing or walking
const SUIT_TOP = [
	'.....kkkkk.....',
	'...kkwcccwkk...',
	'..kwwwcccwwwk..',
	'.kwwkkkkkkkwwk.',
	'.kwkyyyyyWWkwk.',
	'.kwkYyyyyyWkwk.',
	'.kwkYYyyyyykwk.',
	'.kwwkkkkkkkwwk.',
	'..kwwwwwwwwwk..',
	'...kkwlllwkk...',
	'..kwwwwwwwwwk..',
	'.kwwwwwwwwwwwk.',
	'kwwwwcccccwwwwk',
	'kwwkwwcccwwkwwk',
	'kwwkwwwwwwwkwwk',
	'kwwkwwwwwwwkwwk',
	'kwwkwwlllwwkwwk',
	'kwwkwwwwwwwkwwk',
	'kwwkwwwwwwwkwwk',
	'kmmkkkkkkkkkmmk',
	'kkkkwwwkwwwkkkk',
];

// Their legs, down to the boots: a third of them, under a long body and a big helmet
const SUIT_LEGS = Array(6).fill('...kwwwkwwwk...');

// The suit's top with one arm swung forward, as it is in a stride: seen from the front the arm is shorter, its glove
// a row up and nothing below it. `side`: the left of the picture (0) or its right (1)
const swung = side =>
	SUIT_TOP.map((row, index) => {
		const from = side ? 11 : 0;
		const arm = { 18: 'kmmk', 19: 'kkkk', 20: side ? 'k...' : '...k' }[index];

		return arm ? `${row.slice(0, from)}${arm}${row.slice(from + 4)}` : row;
	});

// The suit's legs in a stride, seen from the front: one planted, the other's knee come up so its boot is `lift` rows
// off the floor, the leg that much shorter. `side`: the lifted leg on the left of the picture (0) or its right (1)
const striding = (side, lift) => {
	const rows = SUIT_LEGS.length + 3;
	const leg = (at, up) => {
		const boot = rows - 2 - up;

		if (at > boot + 1) return ['.......', '.......'];
		if (at === boot + 1) return ['..kkkkk', 'kkkkk..'];

		return at === boot ? ['..kmmmm', 'mmmmk..'] : ['...kwww', 'wwwk...'];
	};

	return Array.from({ length: rows }, (_, at) => {
		const [left] = leg(at, side ? 0 : lift);
		const [, right] = leg(at, side ? lift : 0);
		// The seam between the legs: there while either leg is, closing the planted boot's sole under the lifted one
		const seam = at < rows - 1 || lift ? 'k' : '.';

		return `${left}${seam}${right}`;
	});
};

const SUIT = {
	stand: [...SUIT_TOP, ...SUIT_LEGS, '...kwwwkwwwk...', '..kmmmmkmmmmk..', '..kkkkk.kkkkk..'],
	// A stride, as the greys walk but with the knee coming well up: a boot a little off the floor on its way up and
	// down, then high, the arm across from it swung forward at the top of it
	stepLeftLow: [...SUIT_TOP, ...striding(0, 1)],
	stepLeft: [...swung(1), ...striding(0, 3)],
	stepRightLow: [...SUIT_TOP, ...striding(1, 1)],
	stepRight: [...swung(0), ...striding(1, 3)],
	// Stood still, now and then: the light across their visor from its other side, as they look about
	glint: [...SUIT_TOP, ...SUIT_LEGS, '...kwwwkwwwk...', '..kmmmmkmmmmk..', '..kkkkk.kkkkk..'].map(
		(row, index) => ({ 4: '.kwkyWWyyyykwk.', 5: '.kwkYWyyyyykwk.' })[index] ?? row,
	),
	// Sat on a stool, facing us: their legs come toward us, so only the boots show under the body
	sit: [...SUIT_TOP.slice(0, -1), '.kkkmmmkmmmkkk.', '...kkkk.kkkk...'],
};

// Someone at an arcade cabinet to their right: the arm on that side is out to it, drawn apart as it moves, so the
// suit has only its shoulder there
const SUIT_PLAY = SUIT.stand.map((row, index) => {
	if (index === 12) return `${row.slice(0, 12)}k..`;

	return index > 12 && index < SUIT_TOP.length ? `${row.slice(0, 12)}...` : row;
});

// Someone seen from behind, looking in: the back of their helmet striped in their color, their air pack
const SUIT_BACK = [
	'.....kkkkk.....',
	'...kkwcccwkk...',
	'..kwwwcccwwwk..',
	'.kwwwwcccwwwwk.',
	'.kwwwwwwwwwwwk.',
	'.kwwwwwwwwwwwk.',
	'.kwwwwwwwwwwwk.',
	'.kwwwwwwwwwwwk.',
	'..kwwwwwwwwwk..',
	'...kkwlllwkk...',
	'..kmmmmmmmmmk..',
	'.kwmmmmmmmmmwk.',
	'kwwmmlllllmmwwk',
	'kwwmmcccccmmwwk',
	'kwwmmmmmmmmmwwk',
	'kwwmmmmmmmmmwwk',
	'kwwkmmmmmmmkwwk',
	'kwwkwwwwwwwkwwk',
	'kwwkwwwwwwwkwwk',
	'kmmkkkkkkkkkmmk',
	'kkkkwwwkwwwkkkk',
	...SUIT_LEGS,
	'...kwwwkwwwk...',
	'..kmmmmkmmmmk..',
	'..kkkkk.kkkkk..',
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
	'..kkkkk..',
	'kaaaaaaAk',
	'keWeaeWek',
	'keeeaeeek',
	'.kaaeaAk.',
	'..kccck..',
	'.kaaaaAk.',
	'kakaaAkAk',
	'.kkaaAkk.',
	'..kk.kk..',
];
const SMALL_GREY_WORK = [
	'..kkkkk..',
	'kaaaaaaAk',
	'keWeaeWek',
	'keeeaeeek',
	'.kaaeaAk.',
	'a.kccck.a',
	'kkaaaaAkk',
	'.kkaaAkk.',
	'..kaaAk..',
	'..kk.kk..',
];
// A fabled session's monitor: a taller grey of another strain, long in the skull and the leg, that stands behind the
// session's grey and follows its run; its tall collar, up the neck, in the session's color and its chest pip Fable's
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
	'...kcgck...',
	'...kcgck...',
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
// Walking: a foot lifted, the other planted, by turns with standing between, as a grey's
const WATCHER_STEP_LEFT = WATCHER.with(-2, '..kkk.kGk..').with(-1, '.......kk..');
const WATCHER_STEP_RIGHT = WATCHER.with(-2, '..kgk.kkk..').with(-1, '..kk.......');
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
	suitPlay: SUIT_PLAY,
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
		]),
	),
	body: BODIES.stand,
	bodyWave: BODIES.wave,
	bodyStepLeft: BODIES.stepLeft,
	bodyStepRight: BODIES.stepRight,
	bodySit: BODIES.sit,
	bodySitWave: BODIES.sitWave,
	bodyBack: BODIES.stand.map(row => row.replace('s', 'a')),
	suit: SUIT.stand,
	suitGlint: SUIT.glint,
	suitSit: SUIT.sit,
	suitStepLeft: SUIT.stepLeft,
	suitStepRight: SUIT.stepRight,
	suitStepLeftLow: SUIT.stepLeftLow,
	suitStepRightLow: SUIT.stepRightLow,
	lamp: LAMP,
	core: CORE,
	asking: ASKING,
	news: NEWS,
	smallGrey: SMALL_GREY,
	smallGreyWork: SMALL_GREY_WORK,
	watcher: WATCHER,
	watcherPoint: WATCHER_POINT,
	watcherStepLeft: WATCHER_STEP_LEFT,
	watcherStepRight: WATCHER_STEP_RIGHT,
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

// Where a head's cheeks are, the row under its eyes out from each eye's outer corner, as (x, y) within the sprite and
// two pixels wide: a flush goes there
export const cheeksOf = size => {
	const rows = HEADS[size];
	const lowest = rows.findLastIndex(row => row.includes('e'));
	const row = rows[lowest];

	return [
		{ x: row.indexOf('e') - 1, y: lowest + 1 },
		{ x: row.lastIndexOf('e'), y: lowest + 1 },
	];
};

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
