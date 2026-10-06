export const element = (tag, className, text) => {
	const node = document.createElement(tag);

	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;

	return node;
};

export const icon = name => element('i', `fa-solid fa-${name}`);

// A button with a label, an icon, or both
export const button = (label, onPress, { icon: name, title, className = '' } = {}) => {
	const node = element('button', className);

	if (name) node.append(icon(name));
	if (label) node.append(label);
	if (title) node.title = title;
	node.addEventListener('click', onPress);

	return node;
};

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
