import { toned } from '../../shared/hues';

// Light aboard: dark but for lamps, bright where work goes on and dim blue where nothing does, and whatever shines
// throwing its own color round it. Painted at the art's resolution in hard bands so it stays pixel art when scaled,
// multiplied over the scene, and what shines added again faintly as glow.

// How dark an unlit place is, as what it multiplies the art by
const AMBIENT = [58, 66, 92];
// A lamp in a room's ceiling every this many art pixels across
const LAMP_PITCH = 52;

// What stands still painted into `steady` while it stays the same (`painted` what it was painted from), and copied out
// each frame into `shade` and `glow` with what moves added
const steady = {};
let painted;
let shade;
let glow;

const canvasOf = (held, w, h) => {
	const canvas = held ?? document.createElement('canvas');

	if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });

	return canvas;
};

const rgba = ([r, g, b], alpha) => `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;

// Each pool's bands by size, color and strength: the pool is painted about its own middle, so that's all it turns on
const gradients = new Map();
const gradientOf = (paint, r, color, strength) => {
	const key = `${r}|${color}|${strength}`;
	const held = gradients.get(key);

	if (held) return held;
	if (gradients.size > 300) gradients.clear();

	const gradient = paint.createRadialGradient(0, 0, 0, 0, 0, r);

	[
		[0, 1],
		[0.38, 1],
		[0.38, 0.62],
		[0.68, 0.62],
		[0.68, 0.3],
		[1, 0.3],
		[1, 0],
	].forEach(([at, part]) => gradient.addColorStop(at, rgba(color, part * strength)));
	gradients.set(key, gradient);

	return gradient;
};

// A pool of light in bands, squashed `deep` down to lie on a floor seen from the front
const pool = (paint, { x, y, r, color, strength = 1, deep = 1 }) => {
	paint.save();
	paint.translate(Math.round(x), Math.round(y));
	paint.scale(1, deep);
	paint.fillStyle = gradientOf(paint, r, color, strength);
	paint.beginPath();
	paint.arc(0, 0, r, 0, Math.PI * 2);
	paint.fill();
	paint.restore();
};

// Each room lit low to its level, its far wall brighter under its lamps, a pool on its floor under each lamp
const paintLights = (paint, shine, local, { rooms, pools, lights }) => {
	for (const { from, to, color, level, face = 0 } of rooms) {
		const [a, b] = [local(from), local(to)];
		const [across, down] = [b.x - a.x, b.y - a.y];

		paint.fillStyle = rgba(color, level * 0.32);
		paint.fillRect(a.x, a.y, across, down);
		paint.fillStyle = rgba(color, level * 0.3);
		paint.fillRect(a.x, a.y, across, Math.min(face, down));

		const lamps = Math.max(1, Math.round(across / LAMP_PITCH));

		for (let lamp = 0; lamp < lamps; lamp++)
			pool(paint, {
				x: a.x + (across * (lamp + 0.5)) / lamps,
				y: a.y + face + (down - face) * 0.42,
				r: Math.min(across / lamps, (down - face) * 1.6) * 0.62,
				deep: 0.55,
				color,
				strength: level * 0.85,
			});
	}
	for (const light of pools) pool(paint, { ...light, ...local(light) });
	for (const light of lights) {
		const at = local(light);

		pool(paint, { ...light, ...at });
		pool(shine, { ...light, ...at, r: light.r * 0.7, strength: (light.strength ?? 1) * 0.5 });
	}
};

// `area` is what's lit in art pixels; `rooms` each { from, to, color, level } with its far wall `face` pixels deep;
// `lights` points that shine { x, y, r, color, strength }; any of them `moving` when it changes from frame to frame.
// The light adds up the same whatever order it's laid in, so what moves is laid over what doesn't.
export const drawLighting = (ctx, area, { rooms = [], pools = [], lights = [] }) => {
	const [w, h] = [Math.ceil(area.right - area.left), Math.ceil(area.bottom - area.top)];

	if (w <= 0 || h <= 0) return;

	const local = ({ x, y }) => ({ x: x - area.left, y: y - area.top });
	const split = moving => ({
		rooms: rooms.filter(room => Boolean(room.moving) === moving),
		pools: pools.filter(light => Boolean(light.moving) === moving),
		lights: lights.filter(light => Boolean(light.moving) === moving),
	});
	const still = split(false);
	const moved = split(true);
	const key = JSON.stringify([area, still]);

	if (key !== painted || steady.shade?.width !== w || steady.shade?.height !== h) {
		steady.shade = canvasOf(steady.shade, w, h);
		steady.glow = canvasOf(steady.glow, w, h);
		const paint = steady.shade.getContext('2d');
		const shine = steady.glow.getContext('2d');

		paint.globalCompositeOperation = 'source-over';
		paint.fillStyle = rgba(AMBIENT, 1);
		paint.fillRect(0, 0, w, h);
		paint.globalCompositeOperation = 'lighter';
		shine.clearRect(0, 0, w, h);
		shine.globalCompositeOperation = 'lighter';
		paintLights(paint, shine, local, still);
		painted = key;
	}

	let [lit, glowing] = [steady.shade, steady.glow];

	if (moved.rooms.length || moved.pools.length || moved.lights.length) {
		shade = canvasOf(shade, w, h);
		glow = canvasOf(glow, w, h);

		const paint = shade.getContext('2d');
		const shine = glow.getContext('2d');

		for (const [into, from] of [
			[paint, steady.shade],
			[shine, steady.glow],
		]) {
			into.globalCompositeOperation = 'copy';
			into.drawImage(from, 0, 0);
			into.globalCompositeOperation = 'lighter';
		}
		paintLights(paint, shine, local, moved);
		[lit, glowing] = [shade, glow];
	}

	ctx.save();
	ctx.imageSmoothingEnabled = false;
	ctx.globalCompositeOperation = 'multiply';
	ctx.drawImage(lit, Math.round(area.left), Math.round(area.top));
	ctx.globalCompositeOperation = 'lighter';
	ctx.globalAlpha = 0.35;
	ctx.drawImage(glowing, Math.round(area.left), Math.round(area.top));
	ctx.restore();
};

// A color as the lighting takes it, from hsl
export const lightOf = (hue, saturation = 60, lightness = 62) => {
	const [h, toSaturation, toLightness] = toned(hue, saturation, lightness);
	const s = toSaturation / 100;
	const l = toLightness / 100;
	const k = n => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));

	return [f(0), f(8), f(4)];
};
