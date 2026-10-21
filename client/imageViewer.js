import { styled } from '@vanilla-bean/components';

import { button, element, icon } from './dom';

const Viewer = styled.Component`
	position: fixed;
	inset: 0;
	z-index: 30;
	display: flex;
	flex-direction: column;
	background: ${({ colors }) => colors.alpha(colors.vantablack, 0.92)};
	backdrop-filter: blur(8px);
	-webkit-backdrop-filter: blur(8px);
	outline: none;

	.viewer-bar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 12px;
		padding-top: calc(8px + ${({ safeArea }) => safeArea.top});
		min-height: 44px;
		box-sizing: border-box;
	}

	.viewer-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.85;
	}

	.viewer-count {
		opacity: 0.5;
		font-size: 0.85em;
		margin-right: 6px;
		white-space: nowrap;
	}

	.viewer-bar button,
	.viewer-bar a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		opacity: 0.75;
	}

	.viewer-bar button:hover,
	.viewer-bar a:hover {
		opacity: 1;
		background: ${({ colors }) => colors.alpha(colors.white, 0.08)};
	}

	/* Fitted to the screen; a press on the picture shows it at its own size, scrolled to pan */
	.stage {
		flex: 1;
		min-height: 0;
		overflow: auto;
		display: flex;
		position: relative;
	}

	.stage img {
		margin: auto;
		max-width: calc(100% - 24px);
		max-height: calc(100% - 24px);
		object-fit: contain;
		cursor: zoom-in;
		border-radius: 4px;
		background: repeating-conic-gradient(${({ colors }) => colors.alpha(colors.white, 0.06)} 0 25%, transparent 0 50%) 0
			0 / 16px 16px;
	}

	.stage.actual img {
		max-width: none;
		max-height: none;
		cursor: zoom-out;
	}

	.step {
		position: fixed;
		top: 50%;
		transform: translateY(-50%);
		width: 44px;
		height: 64px;
		padding: 0;
		border-radius: 8px;
		background: ${({ colors }) => colors.alpha(colors.vantablack, 0.4)};
		color: inherit;
		font-size: 1.2em;
		opacity: 0.7;
	}

	.step:hover {
		opacity: 1;
	}

	.step.previous {
		left: 8px;
	}

	.step.next {
		right: 8px;
	}

	.failed {
		margin: auto;
		opacity: 0.6;
	}
`;

let showing = null;

export const closeImage = () => showing?.close();

// Shows images over the page: { src, name, download? } each, starting from the one at `at`. Esc, ✕ or a press on the
// dark around it closes; the arrow keys, or a swipe on a phone, step between them.
export const viewImage = (images, at = 0) => {
	closeImage();

	const list = Array.isArray(images) ? images : [images];
	const returnFocus = document.activeElement;
	const viewer = new Viewer({ appendTo: document.body });
	const bar = element('div', 'viewer-bar');
	const name = element('span', 'viewer-name');
	const count = element('span', 'viewer-count');
	const newTab = element('a');
	const download = element('a');
	const stage = element('div', 'stage');
	const previous = button('', () => show(index - 1), {
		icon: 'chevron-left',
		title: 'Previous (←)',
		className: 'step previous variant-flat',
	});
	const next = button('', () => show(index + 1), {
		icon: 'chevron-right',
		title: 'Next (→)',
		className: 'step next variant-flat',
	});
	let index = at;

	Object.assign(newTab, { target: '_blank', rel: 'noopener noreferrer', title: 'Open in a new tab' });
	newTab.append(icon('up-right-from-square'));
	download.title = 'Download it';
	download.append(icon('download'));
	bar.append(
		name,
		count,
		newTab,
		download,
		button('', () => close(), { icon: 'xmark', title: 'Close (Esc)', className: 'variant-flat' }),
	);
	viewer.elem.tabIndex = -1;
	viewer.elem.append(bar, stage, ...(list.length > 1 ? [previous, next] : []));

	const show = to => {
		index = (to + list.length) % list.length;

		const image = list[index];
		const picture = element('img');

		Object.assign(picture, { src: image.src, alt: image.name ?? '' });
		picture.addEventListener('error', () =>
			stage.replaceChildren(element('div', 'failed', 'Could not show this image.')),
		);
		picture.addEventListener('click', () => stage.classList.toggle('actual'));
		stage.classList.remove('actual');
		stage.replaceChildren(picture);
		name.textContent = image.name ?? '';
		name.title = image.name ?? '';
		count.textContent = list.length > 1 ? `${index + 1} of ${list.length}` : '';
		newTab.href = image.src;
		download.href = image.download ?? image.src;
		download.download = image.name ?? '';
	};

	const close = () => {
		viewer.elem.remove();
		showing = null;
		returnFocus?.focus?.({ preventScroll: true });
	};

	// Its own keys, kept from the panels and page underneath
	viewer.elem.addEventListener('keydown', event => {
		const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];

		if (event.key === 'Escape') close();
		else if (step && list.length > 1) show(index + step);
		else return;

		event.preventDefault();
		event.stopPropagation();
	});

	stage.addEventListener('click', event => event.target === stage && close());

	let swipeFrom = null;

	stage.addEventListener('pointerdown', event => {
		if (event.pointerType === 'touch' && !stage.classList.contains('actual')) swipeFrom = event.clientX;
	});
	stage.addEventListener('pointerup', event => {
		const moved = swipeFrom === null ? 0 : event.clientX - swipeFrom;

		swipeFrom = null;
		if (Math.abs(moved) > 60 && list.length > 1) show(index + (moved < 0 ? 1 : -1));
	});

	show(index);
	viewer.elem.focus();
	showing = { close };
};

// An image link that opens over the page rather than in a new tab; a modified click (new tab, download) still works as
// the browser means it
export const opensInViewer = (link, images, at) =>
	link.addEventListener('click', event => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

		event.preventDefault();
		viewImage(images, at);
	});
