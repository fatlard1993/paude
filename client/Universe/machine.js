import { PALETTE, plating } from './art';
import { noise, pixelEllipse, rect } from './station';

// A project's machine: modules for its folders on a plinth, ports down each side for the workers jacked into it. It
// runs while worked on, idles lit low while its sessions wait, is dark while nobody is at it, and flashes amber along
// its top while one of its sessions asks you something.
export const FORMS = ['core', 'coils', 'lattice', 'turbine'];

// What form a part takes from the language its folder is in
const FORM_OF = {
	js: 'core',
	python: 'core',
	jvm: 'core',
	go: 'core',
	rust: 'coils',
	c: 'coils',
	dotnet: 'core',
	swift: 'core',
	ruby: 'core',
	php: 'core',
	web: 'lattice',
	docs: 'coils',
	data: 'turbine',
	shell: 'coils',
};

// One module for each folder, as wide as its share of the files (folders too small to show folded into their
// neighbors), as tall as it is big against the biggest, its form from its language but never the same as the one beside
// it
const modulesOf = (folders, w, fallback) => {
	const total = folders.reduce((sum, { files }) => sum + files, 0);

	if (!total || w < 14) return [{ w, scale: 1, form: fallback }];

	const shown = folders.filter(({ files }) => (files / total) * w >= 7);
	const chosen = shown.length ? shown : folders.slice(0, 1);
	const biggest = Math.max(...chosen.map(({ files }) => files));
	const counted = chosen.reduce((sum, { files }) => sum + files, 0);
	const used = new Set();
	let left = w;

	return chosen.map((folder, index) => {
		const last = index === chosen.length - 1;
		const width = last ? left : Math.max(7, Math.round((folder.files / counted) * w));
		let form = FORM_OF[folder.language] ?? fallback;

		for (let turn = 0; used.has(form) && turn < FORMS.length; turn++)
			form = FORMS[(FORMS.indexOf(form) + 1) % FORMS.length];
		used.add(form);
		left -= width;

		return { w: width, scale: 0.45 + 0.55 * Math.sqrt(folder.files / biggest), form, language: folder.language };
	});
};

// Each language's color, on the band across the top of a module in it, so what a project is written in reads at a
// glance
const LANGUAGE_COLORS = {
	js: '#e8c94a',
	python: '#4a8fe8',
	rust: '#e0703a',
	go: '#4ad0e0',
	jvm: '#d0603a',
	c: '#8a9ab8',
	ruby: '#d04a5a',
	php: '#8a7ad0',
	dotnet: '#7a5ad0',
	swift: '#f08040',
	shell: '#6ac860',
	web: '#e06ab0',
	docs: '#d8dce4',
	data: '#a07ad8',
};

const drawModules = (ctx, { x, top, floor, w }, { folders = [], fallback, hue, state, time, seed, trim, years }) => {
	const full = floor - top;
	let at = x;

	modulesOf(folders, w, fallback).forEach(({ w: width, scale, form, language }, index) => {
		const h = Math.max(14, Math.round(full * scale));
		const y = floor - h;
		const inner = width - (index ? 1 : 0);
		const left = at + (index ? 1 : 0);

		rect(ctx, left, y, inner, h, PALETTE.k);
		rect(ctx, left + 1, y + 1, inner - 2, h - 2, PALETTE.m);
		rect(ctx, left + 1, y + 1, 1, h - 2, PALETTE.l);
		rect(ctx, left + 1, y + 1, inner - 2, 2, LANGUAGE_COLORS[language] ?? trim);
		window(ctx, { x: left + 3, y: y + 5, w: inner - 6, h: h - 10 }, { form, hue, state, time, seed: seed + index });
		if (years >= 2)
			for (let rivet = y + 5; rivet < floor - 3; rivet += 4) {
				rect(ctx, left + 1, rivet, 1, 1, PALETTE.l);
				rect(ctx, left + inner - 2, rivet, 1, 1, PALETTE.l);
			}
		else if (years < 0.5) {
			ctx.globalAlpha = 0.5;
			rect(ctx, left + 2, y + 3, 1, h - 6, PALETTE.W);
			ctx.globalAlpha = 1;
		}
		for (let vent = left + 3; vent < left + inner - 3; vent += 3) rect(ctx, vent, floor - 4, 2, 2, '#0b0e13');
		at += width;
	});
};

const glowOf = (hue, state, time) => {
	if (state === 'idle') return `hsl(${hue ?? 200} 28% 26%)`;
	if (state === 'working') return `hsl(${hue ?? 200} 75% ${60 + Math.round(Math.sin(time * 4) * 6)}%)`;

	return `hsl(${hue ?? 200} 40% 38%)`;
};

const window = (ctx, { x, y, w, h }, { form, hue, state, time, seed }) => {
	const glow = glowOf(hue, state, time);
	const lit = state === 'working';

	rect(ctx, x, y, w, h, '#06090f');
	if (form === 'core') {
		const column = Math.max(3, Math.round(w / 3));
		const left = x + Math.round((w - column) / 2);

		rect(ctx, left, y + 1, column, h - 2, glow);
		if (lit)
			for (let band = (Math.floor(time * 14) % 5) + y + 1; band < y + h - 1; band += 5)
				rect(ctx, left, band, column, 1, PALETTE.W);
		rect(ctx, left, y + 1, 1, h - 2, 'rgba(255, 255, 255, 0.2)');
	} else if (form === 'coils') {
		const spindle = x + Math.round(w / 2);

		rect(ctx, spindle - 1, y + 1, 2, h - 2, PALETTE.d);
		for (let ring = y + 2, index = 0; ring < y + h - 2; ring += 4, index++) {
			const on = lit ? Math.floor(time * 8) % Math.max(1, Math.floor((h - 3) / 4)) === index : false;

			rect(ctx, x + 1, ring, w - 2, 2, '#1d2533');
			rect(ctx, x + 2, ring, w - 4, 1, on ? PALETTE.W : glow);
		}
	} else if (form === 'lattice') {
		for (let row = y + 1; row < y + h - 2; row += 3)
			for (let column = x + 1; column < x + w - 2; column += 3) {
				const on = lit
					? Math.sin(time * 3 + (row * 13 + column * 7 + seed * 50) * 0.37) > 0.2
					: (row + column) % 7 === 0;

				rect(ctx, column, row, 2, 2, on ? glow : '#121a26');
			}
	} else {
		const middle = { x: x + w / 2, y: y + h / 2 };
		const radius = Math.min(w, h) / 2 - 1;
		const turn = lit ? time * 6 : 0;

		pixelEllipse(ctx, Math.round(middle.x), Math.round(middle.y), radius, radius, '#121a26');
		for (let blade = 0; blade < 4; blade++) {
			const angle = turn + (blade * Math.PI) / 2;

			for (let along = 1; along < radius; along++)
				rect(
					ctx,
					Math.round(middle.x + Math.cos(angle) * along),
					Math.round(middle.y + Math.sin(angle) * along),
					1,
					1,
					glow,
				);
		}
		rect(ctx, Math.round(middle.x) - 1, Math.round(middle.y) - 1, 3, 3, PALETTE.l);
	}
};

// The ship's core: the machine of the project the paude flying it runs from, unlike any other project's. A column of
// light in a heavy containment frame from deck to ceiling, rings turning round it (fast while it's worked on, slow
// while its sessions wait, still and dark while nobody's at it), sparks leaping to it at work, its frame's pylons
// carrying the sockets its greys plug into as any machine's do. Answers as drawHousing does.
const CORE_RINGS = 3;

export const drawCore = (
	ctx,
	art,
	housing,
	{ top: ceiling, hue, state, asking, time, sockets = { left: [], right: [] } },
) => {
	const from = art({ x: housing.x, y: 0 }).x;
	const to = art({ x: housing.x + housing.w, y: 0 }).x;
	const floor = art({ x: 0, y: housing.floor }).y;
	const middle = Math.round((from + to) / 2);
	const color = hue ?? 200;
	const lit = state !== 'idle';
	const speed = (state === 'working' && 5) || (state === 'ready' && 1.2) || 0;
	const bright = (light, alpha = 1) => `hsla(${color} 90% ${light}% / ${lit ? alpha : alpha * 0.3})`;
	const top = ceiling + 2;

	// Its frame: a heavy pylon each side, deck to ceiling, hazard-banded at foot and head, lit up its inner edge
	for (const x of [from, to - PYLON]) {
		rect(ctx, x, top, PYLON, floor - top, PALETTE.k);
		rect(ctx, x + 1, top + 1, PYLON - 2, floor - top - 2, '#2c3547');
		rect(ctx, x === from ? x + PYLON - 2 : x + 1, top + 4, 1, floor - top - 8, bright(62, 0.9));
		for (const band of [top + 1, floor - 5])
			for (let step = 0; step < PYLON - 2; step++)
				rect(ctx, x + 1 + step, band, 1, 3, step % 2 ? PALETTE.y : PALETTE.k);
	}
	// Its mounts: a cap bolted to the ceiling and a plinth on the deck, each spanning the frame
	rect(ctx, from, top, to - from, 4, PALETTE.k);
	rect(ctx, from + 1, top + 1, to - from - 2, 2, '#4a5878');
	rect(ctx, from, floor - 5, to - from, 5, PALETTE.k);
	rect(ctx, from + 1, floor - 4, to - from - 2, 3, '#2c3547');
	for (let vent = from + 3; vent < to - 3; vent += 3)
		rect(ctx, vent, floor - 3, 2, 1, lit ? bright(55, 0.8) : '#141a26');

	// Its column: glass round a core of light, brightest at its heart, light running up it while it works
	const column = { left: middle - 5, top: top + 4, w: 11, h: floor - 5 - (top + 4) };

	rect(ctx, column.left, column.top, column.w, column.h, '#0b1018');
	rect(ctx, column.left + 2, column.top, column.w - 4, column.h, bright(30, 0.9));
	rect(ctx, column.left + 3, column.top, column.w - 6, column.h, bright(55));
	rect(ctx, middle - 1, column.top, 3, column.h, bright(82));
	rect(ctx, middle, column.top, 1, column.h, lit ? '#f4fbff' : bright(70));
	rect(ctx, column.left, column.top, 1, column.h, 'rgba(220, 240, 255, 0.25)');
	if (state === 'working')
		for (let rise = column.top + column.h - 1 - (Math.floor(time * 30) % 7); rise > column.top; rise -= 7)
			rect(ctx, column.left + 3, rise, column.w - 6, 1, '#ffffff');

	// Its rings, turning round it: a band across it, the near half bright and the far half dim, a node riding round
	for (let ring = 0; ring < CORE_RINGS; ring++) {
		const y = Math.round(column.top + ((ring + 1) * column.h) / (CORE_RINGS + 1));
		const reach = Math.round((to - from) / 2 - PYLON - 1);
		const turn = time * speed * (ring % 2 ? -1 : 1) + ring * 2.1;
		const node = Math.round(middle + Math.cos(turn) * reach);
		const near = Math.sin(turn) > 0;

		rect(ctx, middle - reach, y - 1, reach * 2 + 1, 1, '#1c2330');
		rect(ctx, middle - reach, y, reach * 2 + 1, 1, '#4a5878');
		rect(ctx, middle - reach, y + 1, reach * 2 + 1, 1, '#2c3547');
		if (near || !lit) rect(ctx, node - 1, y - 1, 3, 3, lit ? bright(78) : '#3a4762');
		else rect(ctx, node, y, 1, 1, bright(60, 0.6));
	}
	// Sparks leaping to it while it's at work
	if (state === 'working' && Math.floor(time * 9) % 3 === 0) {
		const side = Math.floor(time * 5) % 2 ? 1 : -1;
		const y = column.top + Math.floor((time * 37) % column.h);

		for (let step = 0; step < 4; step++) rect(ctx, middle + side * (6 + step), y + (step % 2), 1, 1, '#ffffff');
	}
	if (asking) rect(ctx, from + 1, top + 1, to - from - 2, 2, Math.floor(time * 3) % 2 ? PALETTE.y : PALETTE.Y);

	// Its sockets, on its pylons as any machine's
	const socketAt = (side, index) => ({ x: side < 0 ? from - 1 : to, y: top + 16 + index * 11 });

	for (const [side, taken] of [
		[-1, sockets.left],
		[1, sockets.right],
	])
		taken.forEach((on, index) => {
			const { x, y } = socketAt(side, index);

			rect(ctx, x - (side < 0 ? 1 : 0), y - 1, 2, 3, PALETTE.k);
			rect(ctx, x, y, 1, 1, on ? bright(70) : PALETTE.d);
		});

	return { from, to, top, floor, socket: socketAt };
};

// The machinery a project's machine shows outside the hull, grown from what its modules are: one structure for each,
// as wide as its share and standing as far out as its module stands tall, its form from its language (a tower with a
// glowing cap for a core, a bank of radiator fins for coils, a truss mast for a lattice, a fan in its ring for a
// turbine), banded in its language's color, riveted when the project is old, fresh-sheened when it's new, lit as the
// machine runs and flashing amber at its tips while one of its sessions asks you something. `left` to `right` along the
// hull, from `base`, `out` from it: -1 up off its back, 1 down under its belly; built of the hull's plating in the
// ship's color (`ship`), the project's own (`hue`) its trim and glow.
const EXTERIOR_TALL = 18;
// The hull's own plating in the ship's color, as its skin is painted (hull.js): lighter along the back, in shadow
// under the belly; what grows out of it is built of the same, so it looks part of it
const hullPlating = (ship, side) => {
	const tone =
		side === 'back'
			? { plate: 22, lit: 38, dark: 15, seam: 11, rivet: 31 }
			: { plate: 15, lit: 28, dark: 11, seam: 9, rivet: 22 };

	return {
		outline: '#0b0f17',
		...Object.fromEntries(Object.entries(tone).map(([part, lightness]) => [part, plating(ship, lightness)])),
	};
};
// How far a fairing steps out of the hull's skin before the machinery on it, in art pixels
const FAIRING = 3;

const drawStructure = (ctx, { x, w, h, form, accent, glow, tip, lit, time, seed, years, plating }, row) => {
	const { outline, plate, lit: edge, dark } = plating;
	// `rows` rows from `from` out from the hull, as a rect
	const at = (left, from, width, rows, fill) => row(left, from, width, rows, fill);

	// Each thing about it picked from its seed, so two of a form never look alike
	const pick = (what, from, to) => from + Math.floor(noise(`${seed}|${what}`) * (to - from + 1));

	if (form === 'core') {
		// A cluster of towers on a shared collar, each its own height, rather than one block across it all
		const towers = Math.max(1, Math.round(w / pick('pitch', 6, 9)));
		const each = Math.floor((w - 2) / towers);

		at(x, 0, w, 2, outline);
		at(x + 1, 0, w - 2, 1, edge);
		for (let tower = 0; tower < towers; tower++) {
			const left = x + 1 + tower * each;
			const tw = each - (towers > 1 ? 1 : 0);
			const th = Math.max(6, Math.round(h * (0.55 + 0.45 * noise(`${seed}|tower${tower}`))));
			const core = left + Math.floor(tw / 2);

			at(left, 2, tw, th - 4, outline);
			at(left + 1, 2, tw - 2, th - 4, plate);
			at(left + 1, 2, 1, th - 4, edge);
			at(core, 3, 1, th - 6, glow);
			if (lit) at(core, 3 + (Math.floor(time * 10 + tower * 3) % Math.max(1, th - 6)), 1, 1, PALETTE.W);
			at(left + 1, th - 4, Math.max(1, tw - 2), 1, accent);
			at(left + 1, th - 3, Math.max(1, tw - 2), 2, outline);
			at(left + 2, th - 3, Math.max(1, tw - 4), 1, tip);
		}
	} else if (form === 'coils') {
		// A bank of fins, every so many of them standing proud
		const gap = pick('gap', 2, 3);
		const proud = pick('proud', 2, 4);

		at(x, 0, w, 2, outline);
		at(x + 1, 0, w - 2, 1, dark);
		for (let fin = x + 1, index = 0; fin < x + w - 1; fin += gap, index++) {
			const reach = h - (index % proud === 0 ? 0 : 3);

			at(fin, 2, 1, reach - 2, edge);
			at(fin, reach - 1, 1, 1, tip);
		}
		for (let dot = x + 1; dot < x + w - 1; dot += 4) at(dot, pick('band', 3, Math.max(3, h - 4)), 1, 1, accent);
	} else if (form === 'lattice') {
		const rails = [x + 1, x + w - 2];
		const pitch = pick('braces', 2, 4);

		at(x, 0, w, 2, outline);
		for (const rail of rails) at(rail, 2, 1, h - 3, edge);
		for (let brace = 2; brace < h - 2; brace += pitch)
			for (let step = 0; step < w - 2; step++)
				at(x + 1 + step, brace + Math.round((step / Math.max(1, w - 3)) * 2), 1, 1, dark);
		for (const rail of [x + 1, x + w - 2]) at(rail, 3, 1, 2, accent);
		for (const rail of rails) {
			const on = lit ? Math.sin(time * 4 + rail + seed * 9) > 0 : true;

			at(rail, h - 1, 1, 1, on ? tip : dark);
		}
	} else {
		const r = Math.max(2, Math.floor(Math.min(w, h) / 2) - 1);
		const middle = { x: x + Math.floor(w / 2), along: h - r - 1 };

		at(middle.x - 1, 0, 3, middle.along, outline);
		at(middle.x, 0, 1, middle.along, edge);
		for (let a = 0; a < 24; a++) {
			const angle = (a / 24) * Math.PI * 2;

			at(
				Math.round(middle.x + Math.cos(angle) * r),
				Math.round(middle.along + Math.sin(angle) * r),
				1,
				1,
				a % 6 ? edge : accent,
			);
		}
		const turn = lit ? time * 6 : seed;

		for (let blade = 0; blade < 3; blade++) {
			const angle = turn + (blade * Math.PI * 2) / 3;

			for (let along = 1; along < r; along++)
				at(
					Math.round(middle.x + Math.cos(angle) * along),
					Math.round(middle.along + Math.sin(angle) * along),
					1,
					1,
					glow,
				);
		}
		at(middle.x, middle.along, 1, 1, tip);
	}
	if (years >= 2) for (let rivet = x + 1; rivet < x + w - 1; rivet += 3) at(rivet, 1, 1, 1, edge);
	else if (years < 0.5) {
		ctx.globalAlpha = 0.45;
		at(x + 1, 2, 1, Math.max(1, h - 4), PALETTE.W);
		ctx.globalAlpha = 1;
	}
};

// The ship's command spire, over its core: the tallest thing on its hull, tiered in its plating, a band of light in
// its core's color that runs while it's worked on, a dish atop it turning, and a beacon at its tip
const SPIRE_TALL = 34;

const drawSpire = (ctx, { left, right, row, plating, hue, state, asking, time }) => {
	const middle = Math.round((left + right) / 2);
	const lit = state !== 'idle';
	const light = (l, alpha = 1) => `hsla(${hue ?? 200} 90% ${l}% / ${lit ? alpha : alpha * 0.35})`;
	const { outline, plate, lit: edge, dark } = plating;
	// Tiers narrowing as it rises: [half width, from, rows]
	const tiers = [
		[Math.round((right - left) / 2) - 2, 0, 6],
		[9, 6, 8],
		[6, 14, 10],
		[3, 24, 6],
	];

	for (const [half, from, rows] of tiers) {
		row(middle - half, from, half * 2 + 1, rows, outline);
		row(middle - half + 1, from, half * 2 - 1, rows, plate);
		row(middle - half + 1, from, 1, rows, edge);
		row(middle + half - 1, from, 1, rows, dark);
	}
	// Its band of light round its middle tier, running while it's worked on
	row(middle - 8, 9, 17, 2, light(58));
	if (state === 'working') row(middle - 8 + (Math.floor(time * 14) % 17), 9, 2, 2, '#ffffff');
	for (let port = middle - 4; port <= middle + 4; port += 4) row(port, 18, 1, 2, light(70, 0.9));
	// Its mast, dish and beacon
	row(middle, 30, 1, SPIRE_TALL - 30, edge);
	const tilt = Math.round(Math.sin(time * (state === 'working' ? 1.5 : 0.4)) * 3);

	row(middle - 4 + tilt, 30, 9, 1, edge);
	row(middle - 3 + tilt, 31, 7, 1, plate);
	row(
		middle - 1,
		SPIRE_TALL,
		3,
		2,
		(asking && (Math.floor(time * 3) % 2 ? PALETTE.y : PALETTE.Y)) ||
			(Math.floor(time * 1.5) % 2 ? light(70) : '#5a1a16'),
	);
};

export const drawExterior = (
	ctx,
	{
		left,
		right,
		base,
		out,
		folders = [],
		fallback = 'core',
		hue,
		ship = 200,
		state,
		asking,
		time,
		seed = 0,
		history,
		own = false,
	},
) => {
	const glow = glowOf(hue, state, time);
	const trim = hue === null || hue === undefined ? PALETTE.l : `hsl(${hue} 45% 52%)`;
	const tip = (asking && (Math.floor(time * 3) % 2 ? PALETTE.y : PALETTE.Y)) || (state === 'idle' ? PALETTE.d : glow);
	const years = history?.since ? (Date.now() - history.since) / (365 * DAY_MS) : 1;
	const plating = hullPlating(ship, out < 0 ? 'back' : 'belly');
	const skin = (x, from, width, rows, fill) =>
		width > 0 && rows > 0 && rect(ctx, x, out < 0 ? base - from - rows : base + from, width, rows, fill);
	const row = (x, from, width, rows, fill) => skin(x, from + FAIRING, width, rows, fill);
	let x = left;

	// Its fairing: plating stepped out of the hull's skin under it all, seamed and riveted as the hull is
	for (let step = 0; step < FAIRING; step++) {
		const inset = step * 2;

		skin(left - 4 + inset, step, right - left + 8 - inset * 2, 1, plating.outline);
		skin(
			left - 3 + inset,
			step,
			right - left + 6 - inset * 2,
			1,
			out < 0 && step === FAIRING - 1 ? plating.lit : plating.plate,
		);
	}
	for (let seam = left + 8; seam < right - 2; seam += 20) skin(seam, 0, 1, FAIRING, plating.seam);
	for (let rivet = left + 2; rivet < right - 2; rivet += 6) skin(rivet, 1, 1, 1, plating.rivet);
	if (own) return drawSpire(ctx, { left, right, row, plating, hue, state, asking, time });

	modulesOf(folders, right - left, fallback).forEach(({ w, scale, form, language }, index) => {
		const width = w - (index ? 1 : 0);

		drawStructure(
			ctx,
			{
				x: x + (index ? 1 : 0),
				w: width,
				h: Math.max(7, Math.round(EXTERIOR_TALL * scale)),
				form,
				accent: LANGUAGE_COLORS[language] ?? trim,
				plating,
				glow,
				tip,
				lit: state === 'working',
				time,
				seed: seed + index,
				years,
			},
			row,
		);
		x += w;
	});
};

// A project's machine on its deck: `housing` from housingOf, `top` the art pixel row of the deck's ceiling. A pylon
// each side with the sockets its greys' cables plug into; between them its folders'
// modules on a plinth, a duct from their top up into the hull. Answers where each socket is.
const PYLON = 5;

export const drawHousing = (
	ctx,
	art,
	housing,
	{
		top,
		form,
		hue,
		state,
		asking,
		time,
		seed,
		folders,
		history,
		changed = 0,
		pullRequest,
		sockets = { left: [], right: [] },
		verdict,
		tested,
		pressure,
		fed = [],
	},
) => {
	const from = art({ x: housing.x, y: 0 }).x;
	const to = art({ x: housing.x + housing.w, y: 0 }).x;
	const floor = art({ x: 0, y: housing.floor }).y;
	const w = to - from;
	const ceiling = top;
	const trim = hue === null || hue === undefined ? PALETTE.l : `hsl(${hue} 45% 52%)`;
	const glow = glowOf(hue, state, time);
	const body = { x: from + PYLON, w: w - PYLON * 2 };
	const rows = Math.max(sockets.left.length, sockets.right.length);

	// Its modules about half the deck's height at most, lower the smaller its project
	const size = Math.min(1, Math.log2(1 + (history?.files ?? 30)) / 13);

	top = floor - Math.max(20, Math.round((floor - ceiling) * (0.45 + 0.4 * size)));

	const pylonTop = Math.min(top, floor - 10 - rows * 11);
	const h = floor - top;

	const years = history?.since ? (Date.now() - history.since) / (365 * DAY_MS) : 1;
	const duct = Math.round(body.x + body.w / 2);

	for (const x of [from, to - PYLON]) {
		rect(ctx, x, pylonTop, PYLON, floor - pylonTop, PALETTE.k);
		rect(ctx, x + 1, pylonTop + 1, PYLON - 2, floor - pylonTop - 2, PALETTE.d);
		rect(
			ctx,
			x === from ? x + 1 : x + PYLON - 2,
			pylonTop + 2,
			1,
			floor - pylonTop - 4,
			state === 'idle' ? '#1a2230' : glow,
		);
	}
	rect(ctx, duct - 4, ceiling, 9, top - ceiling, PALETTE.k);
	rect(ctx, duct - 3, ceiling, 7, top - ceiling, PALETTE.d);
	rect(ctx, duct - 3, ceiling, 1, top - ceiling, PALETTE.m);
	if (state !== 'idle') rect(ctx, duct + 1, ceiling, 1, top - ceiling, glow);
	for (let y = ceiling + 6; y < top - 3; y += 7) rect(ctx, duct - 5, y, 11, 1, PALETTE.l);
	rect(ctx, duct - 8, ceiling, 17, 2, PALETTE.k);
	rect(ctx, duct - 7, ceiling, 15, 1, PALETTE.l);
	rect(ctx, duct - 6, top - 2, 13, 2, PALETTE.l);
	drawModules(
		ctx,
		{ x: body.x, top, floor, w: body.w },
		{ folders, fallback: form, hue, state, time, seed, trim, years },
	);
	rect(ctx, body.x - 2, floor - 2, body.w + 4, 3, PALETTE.k);
	rect(ctx, body.x - 1, floor - 2, body.w + 2, 1, PALETTE.l);
	for (let x = body.x + 2; x < body.x + body.w - 1; x += 7) rect(ctx, x, floor - 1, 1, 1, PALETTE.w);
	weather(ctx, { x: body.x, y: top, w: body.w, h }, { history, state, time, seed });
	// Lit in the colors of the systems its sessions use (`fed`)
	if (fed.length) {
		const color = fed[Math.floor(time / 2) % fed.length];

		for (const x of [from + 1, to - 2]) rect(ctx, x, pylonTop + 2, 1, floor - pylonTop - 4, color);
		for (let x = body.x + (Math.floor(time * 12) % 8); x < body.x + body.w - 1; x += 8)
			rect(ctx, x, floor - 2, 1, 1, color);
		ctx.globalAlpha = 0.4;
		rect(ctx, body.x, Math.round(floor - 3 - ((time * 8) % Math.max(1, h - 3))), body.w, 1, color);
		ctx.globalAlpha = 1;
	}
	if (asking) rect(ctx, body.x, top, body.w, 2, Math.floor(time * 3) % 2 ? PALETTE.y : PALETTE.Y);
	health(ctx, { x: body.x + body.w - 5, y: top }, { verdict, tested, time, seed });
	pending(ctx, { from, to, top, floor, body }, { changed, pressure, pullRequest, time });

	const socketAt = (side, index) => ({ x: side < 0 ? from - 1 : to, y: pylonTop + 13 + index * 11 });

	for (const [side, taken] of [
		[-1, sockets.left],
		[1, sockets.right],
	])
		taken.forEach((on, index) => {
			const { x, y } = socketAt(side, index);

			rect(ctx, x - (side < 0 ? 1 : 0), y - 1, 2, 3, PALETTE.k);
			rect(ctx, x, y, 1, 1, on ? glowOf(hue, state === 'idle' ? 'ready' : state, time) : PALETTE.d);
		});
	rect(ctx, from + 2, floor - 1, 4, 1, PALETTE.k);
	rect(ctx, to - 6, floor - 1, 4, 1, PALETTE.k);

	return { from, to, top, floor, socket: socketAt };
};

const DAY_MS = 864e5;

// What its history has done to it: rust with age, patches bolted on with commits, warm vents while it's been worked
// on today, dust over it once nothing has been committed for a month
const weather = (ctx, { x, y, w, h }, { history = {}, state, time, seed }) => {
	const years = history.since ? (Date.now() - history.since) / (365 * DAY_MS) : 0;
	const spot = (index, salt) => Math.abs(Math.sin((seed + 1) * 97.13 + index * 13.7 + salt)) % 1;

	for (let index = 0; index < Math.min(8, Math.round(years * 3)); index++)
		rect(
			ctx,
			x + 1 + Math.floor(spot(index, 1) * (w - 3)),
			y + 1 + Math.floor(spot(index, 2) * (h - 3)),
			2,
			1,
			'#6e4a2a',
		);
	for (let index = 0; index < Math.min(5, Math.round((history.commits ?? 0) / 200)); index++) {
		const [px, py] = [x + 1 + Math.floor(spot(index, 3) * (w - 5)), y + 2 + Math.floor(spot(index, 4) * (h - 5))];

		rect(ctx, px, py, 4, 3, PALETTE.l);
		rect(ctx, px, py, 1, 1, PALETTE.d);
		rect(ctx, px + 3, py + 2, 1, 1, PALETTE.d);
	}
	if ((history.day ?? 0) > 0)
		for (let vent = 0; vent < 3; vent++) {
			const rise = (time * 0.6 + vent / 3) % 1;

			ctx.globalAlpha = 0.5 * (1 - rise);
			rect(ctx, x + 3 + vent * Math.floor((w - 6) / 3), y - 2 - Math.round(rise * 5), 2, 1, '#e8a060');
			ctx.globalAlpha = 1;
		}
	if (history.last && Date.now() - history.last > 30 * DAY_MS && state !== 'working') {
		ctx.globalAlpha = 0.35;
		for (let index = 0; index < 18; index++)
			rect(ctx, x + Math.floor(spot(index, 5) * w), y + Math.floor(spot(index, 6) * h), 1, 1, '#8a8a7a');
		ctx.globalAlpha = 1;
	}
};

const health = (ctx, { x, y }, { verdict, tested, time, seed }) => {
	if (!verdict) return;

	const failing = tested === 'failing';
	const blink = tested === 'stale' && Math.floor(time * 2) % 2;

	rect(ctx, Math.round(x) - 2, y - 3, 5, 3, PALETTE.k);
	rect(ctx, Math.round(x) - 1, y - 2, 3, 1, blink ? '#3a3020' : verdict);
	if (!failing) return;
	for (let spark = 0; spark < 4; spark++) {
		const along = (time * 2.2 + spark / 4 + seed) % 1;
		const angle = Math.PI * (1.15 + ((spark * 37) % 70) / 100);

		rect(
			ctx,
			Math.round(x + Math.cos(angle) * along * 9),
			Math.round(y - 3 + Math.sin(angle) * along * 9),
			1,
			1,
			along < 0.5 ? PALETTE.W : PALETTE.y,
		);
	}
	for (let puff = 0; puff < 3; puff++) {
		const rise = (time * 0.5 + puff / 3) % 1;

		ctx.globalAlpha = 0.45 * (1 - rise);
		rect(ctx, Math.round(x) - 2 + puff, y - 6 - Math.round(rise * 10), 3, 2, '#6a6f78');
		ctx.globalAlpha = 1;
	}
};

const pending = (ctx, { to, floor, body }, { changed, pressure, pullRequest, time }) => {
	for (let panel = 0; panel < Math.min(3, changed); panel++) {
		const x = body.x + 3 + panel * 6;

		rect(ctx, x, floor - 9, 4, 5, '#ffd27a');
		rect(ctx, x + 1, floor - 10, 4, 6, PALETTE.k);
		rect(ctx, x + 2, floor - 9, 3, 4, PALETTE.l);
	}
	if (pressure) {
		const [x, height] = [to + 2, 14];
		const fill = Math.round(height * Math.min(1, pressure / 5));

		rect(ctx, x - 1, floor - height - 2, 5, height + 2, PALETTE.k);
		rect(ctx, x, floor - 1 - fill, 3, fill, PALETTE.o);
		rect(ctx, x, floor - height - 1, 1, height, 'rgba(255, 255, 255, 0.2)');
		if (pressure >= 5)
			for (let puff = 0; puff < 2; puff++) {
				const rise = (time * 0.9 + puff / 2) % 1;

				ctx.globalAlpha = 0.5 * (1 - rise);
				rect(ctx, x + Math.round(rise * 4), floor - height - 4 - Math.round(rise * 7), 2, 2, '#c3cad6');
				ctx.globalAlpha = 1;
			}
	}
	if (pullRequest?.state === 'OPEN') {
		const { failing = 0, pending: running = 0 } = pullRequest.checks ?? {};
		const light =
			(pullRequest.draft && PALETTE.l) ||
			(failing && PALETTE.r) ||
			(running && (Math.floor(time * 2) % 2 ? PALETTE.y : PALETTE.Y)) ||
			PALETTE.t;
		const x = to + 1;
		const y = floor - (pressure ? 26 : 12);

		rect(ctx, x, y, 7, 8, PALETTE.k);
		rect(ctx, x + 1, y + 1, 5, 6, PALETTE.l);
		rect(ctx, x + 2, y - 2, 3, 2, light);
	}
};
