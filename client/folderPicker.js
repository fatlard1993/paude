import { appendStyles, theme } from '@vanilla-bean/components';

import { element, icon } from './dom';

const { colors, space, radius } = theme;

const STYLES = `
	.folder-tree {
		max-height: 40vh;
		min-height: 120px;
		overflow: auto;
		border: 1px solid ${colors.alpha(colors.white, 0.12)};
		border-radius: ${radius.md};
		padding: ${space.xs} 0;
	}

	.folder-tree .row {
		display: flex;
		align-items: center;
		gap: ${space.xs};
		padding: 3px ${space.sm};
		cursor: pointer;
		white-space: nowrap;
	}

	.folder-tree .row:hover {
		background: ${colors.alpha(colors.white, 0.06)};
	}

	.folder-tree .row.picked {
		background: ${colors.alpha(colors.blue, 0.28)};
	}

	.folder-tree .row i {
		width: 1.1em;
		text-align: center;
		color: ${colors.muted};
	}

	.folder-tree .row .note,
	.folder-tree .row.making,
	.folder-tree .said {
		color: ${colors.muted};
	}

	.folder-tree .row .note {
		margin-left: ${space.sm};
		font-size: 0.85em;
	}

	.folder-tree .row.new .name {
		font-style: italic;
	}

	.folder-tree .row input {
		flex: 1;
		min-width: 8em;
	}

	.folder-tree .said {
		padding: ${space.sm};
		white-space: normal;
	}
`;

const INDENT = 16;

// The path under a folder's: `name` in `path`
export const within = (path, name) => `${path === '/' ? '' : path}/${name}`;

// A machine's folders as a tree to pick one from, or to make one in: the home folder open at first, each folder's own
// read when it's opened. Picking a row tells `onPick({ path, create })`; under the folder picked is a row that makes a
// new one there: named, it's in the tree as picked and `create`, and made only when it's added. `list(path)` reads a
// folder's folders (api's listFolders, already given where). Resolves nothing: { elem, load(), picked() }, `load`
// starting over (another machine's folders, say).
export const folderPicker = ({ list, onPick }) => {
	appendStyles(STYLES, 'folder-picker');

	const elem = element('div', 'folder-tree');
	let root = null;
	let picked = null;
	let naming = null;
	let said = null;

	const nodeOf = (path, name, more = {}) => ({ path, name, open: false, children: null, ...more });
	const pick = node => {
		picked = node;
		onPick?.({ path: node.path, create: Boolean(node.create) });
	};
	const open = async node => {
		if (node.create) return (node.open = true);
		if (!node.children) {
			const { body, response } = await list(node.path);

			if (!response?.ok) {
				node.failed = typeof body === 'string' && body ? body : "That folder can't be read.";
				node.children = [];
			} else
				node.children = body.folders.map(({ name, project }) => nodeOf(within(body.path, name), name, { project }));
		}
		node.open = true;
	};
	const rowOf = (node, depth) => {
		const row = element('div', `row${node === picked ? ' picked' : ''}${node.create ? ' new' : ''}`);

		row.style.paddingLeft = `${8 + depth * INDENT}px`;
		row.append(icon(node.open ? 'folder-open' : 'folder'), element('span', 'name', node.name));
		if (node.create) row.append(element('span', 'note', 'new, made when added'));
		else if (node.project) row.append(element('span', 'note', 'a project already'));
		row.addEventListener('click', async () => {
			// Pressed again once picked and open, it closes; else it's picked and opened
			if (node === picked && node.open) node.open = false;
			else {
				pick(node);
				await open(node);
			}
			naming = null;
			render();
		});

		return row;
	};
	// Under the folder picked: the row that makes a new one in it, a field once it's pressed
	const makerOf = (node, depth) => {
		const row = element('div', 'row making');

		row.style.paddingLeft = `${8 + depth * INDENT}px`;
		if (naming !== node) {
			row.append(icon('folder-plus'), element('span', 'name', 'New folder here…'));
			row.addEventListener('click', () => {
				naming = node;
				render();
			});

			return row;
		}

		const input = element('input');

		input.placeholder = 'Its name, then Enter';
		row.append(icon('folder-plus'), input);
		input.addEventListener('keydown', event => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				naming = null;

				return render();
			}
			if (event.key !== 'Enter') return;
			// Its own Enter, not the form's it sits in
			event.preventDefault();

			const name = input.value.trim();

			if (!name || name.includes('/') || name === '.' || name === '..') return;

			const had = (node.children ??= []).find(child => child.name === name);
			const made = had ?? nodeOf(within(node.path, name), name, { create: true, children: [] });

			if (!had) node.children.unshift(made);
			naming = null;
			pick(made);
			render();
		});
		setTimeout(() => input.focus({ preventScroll: true }));

		return row;
	};
	const rowsOf = (node, depth) => [
		rowOf(node, depth),
		...(node.open && node === picked ? [makerOf(node, depth + 1)] : []),
		...(node.open && node.failed ? [Object.assign(element('div', 'said', node.failed), {})] : []),
		...(node.open ? (node.children ?? []).flatMap(child => rowsOf(child, depth + 1)) : []),
	];
	function render() {
		if (said) return elem.replaceChildren(element('div', 'said', said));

		elem.replaceChildren(...(root ? root.flatMap(node => rowsOf(node, 0)) : [element('div', 'said', 'Reading…')]));
	}

	const load = async () => {
		root = null;
		picked = null;
		naming = null;
		said = null;
		render();

		const { body, response } = await list();

		if (!response?.ok) {
			// A paude from before folders could be listed: the path is typed, as it always could be
			said = "This machine's folders can't be listed from here; type the folder's path above.";

			return render();
		}

		const home = nodeOf(body.path, '~ (home)', {
			open: true,
			children: body.folders.map(({ name, project }) => nodeOf(within(body.path, name), name, { project })),
		});

		root = [home, nodeOf('/', '/ (the whole machine)')];
		render();
	};

	return { elem, load, picked: () => picked && { path: picked.path, create: Boolean(picked.create) } };
};
