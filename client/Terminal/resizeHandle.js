import { dragHandle } from '../dom';
import { recall, remember } from '../storage';

const MIN_PANEL_WIDTH = 260;
const MIN_PANEL_HEIGHT = 140;

// Where each kind of panel is dragged from, and the size it keeps, the same on a session and a project's page: the
// right-hand panels share one width
export const PANEL_EDGES = {
	side: { variable: '--notes-width', key: 'paude.notesWidth', edge: 'left' },
	files: { variable: '--files-width', key: 'paude.filesWidth', edge: 'right' },
	shell: { variable: '--shell-height', key: 'paude.shellHeight', edge: 'top' },
};

// A side panel's inner edge drags its width; the side terminal's top edge drags its height
export const addResizeHandle = (panel, { variable, key, edge }) => {
	const handle = document.createElement('div');
	const vertical = edge === 'top';
	const setWidth = size => {
		const [min, max] = vertical
			? [MIN_PANEL_HEIGHT, window.innerHeight * 0.85]
			: [MIN_PANEL_WIDTH, window.innerWidth * 0.9];
		const clamped = Math.round(Math.min(Math.max(size, min), max));

		panel.style.setProperty(variable, `${clamped}px`);

		return clamped;
	};

	handle.className = 'resize';
	panel.append(handle);

	if (Number(recall(key))) setWidth(Number(recall(key)));

	let bounds;
	const widthAt = event => {
		if (vertical) return bounds.bottom - event.clientY;

		return edge === 'left' ? bounds.right - event.clientX : event.clientX - bounds.left;
	};

	dragHandle(handle, {
		onStart: () => {
			bounds = panel.getBoundingClientRect();
			panel.classList.add('resizing');
		},
		onMove: event => setWidth(widthAt(event)),
		onDone: event => {
			remember(key, String(setWidth(widthAt(event))));
			panel.classList.remove('resizing');
		},
	});
};
