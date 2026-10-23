import { Button, Link, theme } from '@vanilla-bean/components';

// The page styles no bare elements, so fields carry the library's look by class, as its own components do; a button is
// the library's Button and a link its Link, with no tooltip: a link here says where it goes by its title, if at all
const LOOKS = { input: 'vbc-input', textarea: 'vbc-input', select: 'vbc-input' };

export const element = (tag, className, text) => {
	if (tag === 'button') {
		const classes = className?.split(' ') ?? [];
		const variant = classes.find(name => name.startsWith('variant-'));

		return new Button({ variant: variant?.slice('variant-'.length), addClass: classes, textContent: text }).elem;
	}
	if (tag === 'a') return new Link({ addClass: className?.split(' '), textContent: text, tooltip: false }).elem;

	const node = document.createElement(tag);
	const look = [LOOKS[tag], className].filter(Boolean).join(' ');

	if (look) node.className = look;
	if (text !== undefined) node.textContent = text;

	return node;
};

export const icon = name => element('i', `fa-solid fa-${name}`);

// A button with a label, an icon, or both. The glyph is a child, which Button's own icon spacing doesn't reach, and
// callers swap it by firstChild
export const button = (label, onPress, { icon: name, title, className = '' } = {}) => {
	const node = element('button', className);

	if (name) node.append(icon(name));
	if (name && label) node.firstChild.style.marginRight = theme.space.sm;
	if (label) node.append(label);
	if (title) node.title = title;
	node.addEventListener('click', onPress);

	return node;
};

// The same close button on every panel
export const closeButton = onPress =>
	button('', onPress, { icon: 'xmark', title: 'Close (Esc)', className: 'icon-only close' });

// A handle dragged with any pointer: each move and the release report the pointer's event
export const dragHandle = (handle, { onStart, onMove, onDone }) => {
	handle.addEventListener('pointerdown', start => {
		start.preventDefault();
		handle.setPointerCapture(start.pointerId);
		onStart?.(start);

		const stop = event => {
			onDone(event);
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', stop);
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', stop);
	});
};
