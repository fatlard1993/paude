import { Notify } from '@vanilla-bean/components';

import { attachFileText } from '../../shared/attachText';
import { createEntry, manageFiles, rawFileUrl, uploadFile } from '../api';
import confirmDialog, { nameDialog } from '../confirmDialog';
import { canType } from '../identity';
import { openMenu } from '../menu';
import { copyWithNotice } from './copySelection';

const PATHS_TYPE = 'application/x-paude-paths';
const HOLD_MS = 500;
const HOLD_SLOP_PX = 10;
// The click that ends a press-and-hold is part of the hold, not a tap on the row
const HELD_CLICK_MS = 800;
const EXPAND_ON_HOVER_MS = 700;
const MAX_UPLOAD = 50 * 1024 * 1024;
const UNDO_MS = 10_000;
const TOUCH = window.matchMedia('(pointer: coarse)');

const parentOf = path => path.split('/').slice(0, -1).join('/');
const nameOf = path => path.split('/').at(-1);
const joined = (folder, name) => (folder ? `${folder}/${name}` : name);
const inside = (path, folder) => path === folder || path.startsWith(`${folder}/`);
const counted = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const named = paths => (paths.length === 1 ? paths[0] : counted(paths.length, 'item'));

const failed = (body, fallback) =>
	new Notify({ type: 'error', content: typeof body === 'string' && body ? body : fallback });

// A file's name is split at its extension; a folder's isn't
const splitName = (name, folder) => {
	const dot = folder ? -1 : name.lastIndexOf('.');

	return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
};

// What a rename picks to type over: the name, short of its extension
const stemRange = (path, folder) => {
	const start = path.length - nameOf(path).length;

	return [start, start + splitName(nameOf(path), folder)[0].length];
};

// "name copy.ext", then "name copy 2.ext": the first not taken
const copyName = (path, taken, folder) => {
	const [stem, extension] = splitName(nameOf(path), folder);

	for (let count = 1; ; count += 1) {
		const candidate = joined(parentOf(path), `${stem} copy${count > 1 ? ` ${count}` : ''}${extension}`);

		if (!taken.has(candidate)) return candidate;
	}
};

// What was dropped from the computer, folders walked: [{ file, path }], each path relative to where it was dropped.
// The entries are taken before anything waits, as a drop's items are gone once its handler returns.
const droppedFiles = async dataTransfer => {
	const entries = [...dataTransfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);

	if (!entries.length) return [...dataTransfer.files].map(file => ({ file, path: file.name }));

	const found = [];
	const visit = async (entry, prefix) => {
		if (entry.isFile) {
			found.push({
				file: await new Promise((resolve, reject) => entry.file(resolve, reject)),
				path: prefix + entry.name,
			});

			return;
		}

		const reader = entry.createReader();
		let batch;

		// A folder's reader hands its entries over in batches, then an empty one
		while ((batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))).length)
			for (const child of batch) await visit(child, `${prefix}${entry.name}/`);
	};

	for (const entry of entries) await visit(entry, '');

	return found;
};

// The files panel's file management, as an editor's explorer does it: a selection (click, Ctrl or Cmd+click, Shift+click,
// the arrow keys), a menu on a right click or a press and hold, a clipboard to cut or copy into another folder, dragging
// to move (holding Ctrl or Alt to copy), files dropped in from the computer, and undo for a move or a delete
export default class FileManager {
	constructor(panel) {
		this.panel = panel;
		this.selected = new Set();
		this.anchor = null;
		this.cursor = null;
		this.clipboard = null;
	}

	get sessionId() {
		return this.panel.options.sessionId;
	}

	isFolder(path) {
		return path === '' || !this.panel.paths.includes(path);
	}

	// Every path the list knows, and every folder on the way to one
	taken() {
		const taken = new Set([...this.panel.paths, ...this.panel.madeFolders]);

		for (const path of [...taken])
			for (let folder = parentOf(path); folder && !taken.has(folder); folder = parentOf(folder)) taken.add(folder);

		return taken;
	}

	rows() {
		return [...this.panel.list.querySelectorAll('[data-entry]')];
	}

	// What an action takes: the selection when the row it's on is part of it, that row alone otherwise
	targets(path = this.cursor) {
		if (path === null) return [];

		return this.selected.has(path) ? [...this.selected] : [path];
	}

	// The folder a paste or a drop goes into: a folder's own, a file's parent
	folderAt(path) {
		if (path === null) return '';

		return this.isFolder(path) ? path : parentOf(path);
	}

	select(paths, { anchor = paths.at(-1) ?? null } = {}) {
		this.selected = new Set(paths);
		this.anchor = anchor;
		this.cursor = paths.at(-1) ?? this.cursor;
		this.paint();
	}

	// Classes on the rows already shown, so changing the selection doesn't rebuild the list
	paint() {
		for (const row of this.rows()) this.paintRow(row);
	}

	paintRow(row) {
		const path = row.dataset.entry;

		row.classList.toggle('selected', this.selected.has(path));
		row.classList.toggle('cursor', path === this.cursor);
		row.classList.toggle('cut', Boolean(this.clipboard?.cut && this.clipboard.paths.some(cut => inside(path, cut))));
	}

	// A row the list shows: one to select, open a menu on, drag, and drop onto
	decorate(row, path) {
		row.dataset.entry = path;
		this.paintRow(row);
		row.addEventListener('contextmenu', event => {
			event.preventDefault();
			event.stopPropagation();
			if (Date.now() - (this.heldAt ?? 0) > HELD_CLICK_MS) this.openMenu({ x: event.clientX, y: event.clientY }, path);
		});
		this.holdOpensMenu(row, path);
		if (!TOUCH.matches && canType()) {
			row.draggable = true;
			row.addEventListener('dragstart', event => this.dragStart(event, path));
		}
		this.acceptDrops(row, () => this.folderAt(path), { expands: this.isFolder(path) ? path : null });
	}

	// The list's own space, past its rows: the project itself
	decorateList(list) {
		list.tabIndex = 0;
		list.addEventListener('keydown', event => this.keydown(event));
		list.addEventListener('contextmenu', event => {
			event.preventDefault();
			this.select([]);
			this.openMenu({ x: event.clientX, y: event.clientY }, null);
		});
		this.acceptDrops(list, () => '');
	}

	// Touch has no right click: a press held still opens the menu
	holdOpensMenu(row, path) {
		let timer;
		let start;
		const cancel = () => {
			clearTimeout(timer);
			start = null;
		};

		row.addEventListener('pointerdown', event => {
			if (event.pointerType !== 'touch') return;

			start = { x: event.clientX, y: event.clientY };
			timer = setTimeout(() => {
				this.heldAt = Date.now();
				this.openMenu(start, path);
			}, HOLD_MS);
		});
		row.addEventListener('pointermove', event => {
			if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOLD_SLOP_PX) cancel();
		});
		for (const type of ['pointerup', 'pointercancel', 'pointerleave']) row.addEventListener(type, cancel);
	}

	// A click on a row: true when it only changed the selection (or ended a hold), so the row shouldn't open
	pressed(event, path) {
		if (Date.now() - (this.heldAt ?? 0) < HELD_CLICK_MS) return true;

		if (event.shiftKey && this.anchor !== null) {
			this.selectRange(this.anchor, path);

			return true;
		}

		if (event.ctrlKey || event.metaKey) {
			const selected = new Set(this.selected);

			if (selected.has(path)) selected.delete(path);
			else selected.add(path);
			this.select([...selected], { anchor: path });
			this.cursor = path;
			this.paint();

			return true;
		}

		this.select([path]);

		return false;
	}

	selectRange(from, to) {
		const paths = this.rows().map(row => row.dataset.entry);
		const [start, end] = [paths.indexOf(from), paths.indexOf(to)].sort((a, b) => a - b);

		if (start < 0) return this.select([to]);

		this.select(paths.slice(start, end + 1), { anchor: from });
		this.cursor = to;
		this.paint();
	}

	openMenu(at, path) {
		if (path !== null && !this.selected.has(path)) this.select([path]);

		const items = this.menuItems(path === null ? [] : this.targets(path));

		if (items.length) openMenu(at, items);
	}

	menuItems(paths) {
		const typing = canType();
		const files = paths.filter(path => !this.isFolder(path));
		const items = [];
		const add = (when, label, onPress) => when && items.push({ label, onPress });
		const [only] = paths.length === 1 ? paths : [];
		const into = paths.length > 1 ? null : this.folderAt(only ?? null);
		const { current } = this.panel;

		if (paths.length === 0 || (only !== undefined && this.isFolder(only))) {
			add(typing, 'New file...', () => this.create({ inside: into }));
			add(typing, 'New folder...', () => this.create({ inside: into, folder: true }));
			add(typing, 'Upload files...', () => this.pickUploads(into));
			add(typing, 'Upload a folder...', () => this.pickUploads(into, { folder: true }));
			add(only !== undefined, 'Find in folder', () => this.panel.findIn(only));
		} else if (only !== undefined) {
			add(true, 'Open', () => this.panel.open(only));
			add(true, 'Download', () => this.download(only));
			add(typing, 'Attach to prompt', () => this.panel.options.attach(attachFileText(only)));
			add(current && current !== only && !this.isFolder(current), `Compare with ${nameOf(current ?? '')}`, () =>
				this.panel.openDiffSet({ source: 'files', a: current, b: only }),
			);
			add(true, 'Compare with...', () => this.panel.startComparing(only));
		} else {
			add(files.length === 2 && paths.length === 2, 'Compare these two', () =>
				this.panel.openDiffSet({ source: 'files', a: files[0], b: files[1] }),
			);
			add(typing && files.length === paths.length, `Attach ${counted(files.length, 'file')}`, () =>
				this.panel.options.attach(files.map(attachFileText).join('')),
			);
		}

		if (paths.length) add(true, paths.length === 1 ? 'Copy path' : 'Copy paths', () => this.copyPaths(paths));

		if (!typing) return items;

		if (paths.length) {
			add(true, 'Cut', () => this.toClipboard(paths, { cut: true }));
			add(true, 'Copy', () => this.toClipboard(paths));
		}
		if (this.clipboard && into !== null)
			add(true, `Paste ${named(this.clipboard.paths.map(nameOf))}${into ? ` into ${nameOf(into)}` : ''}`, () =>
				this.paste(into),
			);
		if (only !== undefined) {
			add(true, 'Duplicate', () => this.duplicate(only));
			add(true, 'Rename...', () => this.rename(only));
		}
		if (paths.length)
			add(true, paths.length === 1 ? 'Delete' : `Delete ${counted(paths.length, 'item')}`, () => this.delete(paths));

		return items;
	}

	copyPaths(paths) {
		copyWithNotice(paths.join('\n'), paths.length === 1 ? 'Path copied' : `${paths.length} paths copied`);
	}

	toClipboard(paths, { cut = false } = {}) {
		this.clipboard = { paths, cut };
		this.paint();
	}

	download(path) {
		const link = document.createElement('a');

		link.href = rawFileUrl(this.sessionId, path, { download: true });
		link.download = nameOf(path);
		link.click();
	}

	// Made where it's asked for, or where the list was last looked into: the folder last opened, or the open file's
	async create({ inside: folder = this.panel.here ?? '', folder: isFolder = false } = {}) {
		const prefix = folder ? `${folder}/` : '';
		const path = await nameDialog({
			header: isFolder ? 'New folder' : 'New file',
			placeholder: isFolder ? 'src/components' : 'src/new.js',
			current: prefix,
			select: [prefix.length, prefix.length],
			confirmLabel: 'Create',
		});

		if (!path || path === prefix) return;

		const { body, response } = await createEntry(this.sessionId, path, isFolder);

		if (!response?.ok) return failed(body, 'Could not make it.');

		this.panel.reveal(body.path, { folder: isFolder });
		if (isFolder) this.panel.madeFolders.add(body.path);
		await this.panel.refresh();
		this.select([body.path]);
		if (isFolder) return;
		if (!body.listed)
			return new Notify({ type: 'warning', content: `Made ${body.path}, but git ignores it, so it isn't listed.` });

		await this.panel.open(body.path);
		if (this.panel.current === body.path && this.panel.lines) this.panel.startEditing();
	}

	async rename(path) {
		const folder = this.isFolder(path);
		const to = await nameDialog({
			header: `Rename ${nameOf(path)}`,
			placeholder: path,
			current: path,
			select: stemRange(path, folder),
			confirmLabel: 'Rename',
		});

		if (to && to !== path) await this.move([{ from: path, to }]);
	}

	async move(moves, { undoing = false } = {}) {
		const { body, response } = await manageFiles(this.sessionId, 'move', { moves });

		if (!response?.ok) return failed(body, 'Could not move it.');

		this.panel.followMoves(body.moved);
		for (const { to } of body.moved) this.panel.reveal(to);
		await this.panel.refresh();
		this.select(body.moved.map(({ to }) => to));
		if (undoing) return;

		const [first] = body.moved;
		const renamed = body.moved.length === 1 && parentOf(first.from) === parentOf(first.to);

		new Notify({
			type: 'success',
			timeout: UNDO_MS,
			content: renamed
				? `Renamed to ${nameOf(first.to)}`
				: `Moved ${named(body.moved.map(({ from }) => nameOf(from)))} to ${parentOf(first.to) || 'the project'}`,
			actions: [
				{
					textContent: 'Undo',
					onPress: () =>
						this.move(
							body.moved.map(({ from, to }) => ({ from: to, to: from })),
							{ undoing: true },
						),
				},
			],
		});
	}

	async copy(copies) {
		const { body, response } = await manageFiles(this.sessionId, 'copy', { copies });

		if (!response?.ok) return failed(body, 'Could not copy it.');

		for (const { to } of body.copied) this.panel.reveal(to);
		await this.panel.refresh();
		this.select(body.copied.map(({ to }) => to));
	}

	duplicate(path) {
		return this.copy([{ from: path, to: copyName(path, this.taken(), this.isFolder(path)) }]);
	}

	async paste(folder) {
		const { paths, cut } = this.clipboard;

		if (cut) this.clipboard = null;
		await this.transfer(paths, folder, { cut });
	}

	// Into a folder: a copy beside its original is named as a copy; a move skips what's already there
	transfer(paths, folder, { cut }) {
		const taken = this.taken();
		const pairs = paths
			.filter(path => path !== folder && (!cut || parentOf(path) !== folder))
			.map(path => {
				let to = joined(folder, nameOf(path));

				if (!cut && taken.has(to)) to = copyName(to, taken, this.isFolder(path));
				taken.add(to);

				return { from: path, to };
			});

		if (!pairs.length) return;

		return cut ? this.move(pairs) : this.copy(pairs);
	}

	async delete(paths) {
		const folders = paths.filter(path => this.isFolder(path));

		if (folders.length || paths.length > 1) {
			const sure = await confirmDialog({
				header: `Delete ${named(paths)}?`,
				body: `${folders.length ? 'Everything inside goes with it. ' : ''}You can undo it for a moment after.`,
				confirmLabel: 'Delete',
			});

			if (!sure) return;
		}

		const { current } = this.panel;

		if (current && paths.some(path => inside(current, path)) && !(await this.panel.leaveEditing())) return;

		const { body, response } = await manageFiles(this.sessionId, 'delete', { paths });

		if (!response?.ok) return failed(body, 'Could not delete it.');

		this.panel.forget(body.deleted);
		this.select([]);
		await this.panel.refresh();
		new Notify({
			type: 'success',
			timeout: UNDO_MS,
			content: `Deleted ${named(body.deleted)}`,
			actions: [{ textContent: 'Undo', onPress: () => this.restore(body.trash) }],
		});
	}

	async restore(trash) {
		const { body, response } = await manageFiles(this.sessionId, 'restore', { trash });

		if (!response?.ok) return failed(body, 'Could not bring it back.');

		await this.panel.refresh();
		// An empty folder only shows as one made here
		for (const path of body.restored)
			if (!this.panel.paths.some(listed => inside(listed, path))) this.panel.madeFolders.add(path);
		for (const path of body.restored) this.panel.reveal(path);
		this.panel.renderList();
		this.select(body.restored);
	}

	pickUploads(folder, { folder: picksFolder = false } = {}) {
		const input = document.createElement('input');

		input.type = 'file';
		input.multiple = true;
		input.webkitdirectory = picksFolder;
		input.addEventListener('change', () =>
			this.upload(
				[...input.files].map(file => ({ file, path: file.webkitRelativePath || file.name })),
				folder,
			),
		);
		input.click();
	}

	// One at a time, then whichever were already there replaced only if that's what's wanted
	async upload(dropped, folder) {
		const tooBig = dropped.filter(({ file }) => file.size > MAX_UPLOAD);
		const wanted = dropped.filter(({ file }) => file.size <= MAX_UPLOAD);

		if (tooBig.length) failed(`Too big to upload (50MB at most): ${tooBig.map(({ path }) => path).join(', ')}`);
		if (!wanted.length) return;

		const progress = new Notify({
			type: 'info',
			content: `Uploading ${counted(wanted.length, 'file')}...`,
			timeout: 0,
		});
		const made = [];
		const refused = [];
		const conflicts = [];
		const send = async ({ file, path }, replace) => {
			const { body, response } = await uploadFile(this.sessionId, joined(folder, path), file, { replace });

			if (response?.ok) made.push(body);
			else if (response?.status === 409 && !replace) conflicts.push({ file, path });
			else refused.push(typeof body === 'string' && body ? body : `${path} didn't upload`);
		};

		for (const item of wanted) await send(item, false);
		progress.hide();

		if (conflicts.length) {
			const names = conflicts.map(({ path }) => joined(folder, path));
			const replace = await confirmDialog({
				header: conflicts.length === 1 ? `Replace ${names[0]}?` : `Replace ${conflicts.length} files?`,
				body:
					conflicts.length === 1
						? 'A file by that name is already there.'
						: `Already there: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', ...' : ''}`,
				cancelLabel: 'Keep them',
				confirmLabel: 'Replace',
			});

			if (replace) for (const item of conflicts) await send(item, true);
		}

		for (const { path } of made) this.panel.reveal(path);
		await this.panel.refresh();
		this.select(made.map(({ path }) => path));

		const unlisted = made.filter(({ listed }) => !listed).length;

		if (refused.length) failed(refused.join('\n'));
		if (made.length)
			new Notify({
				type: unlisted ? 'warning' : 'success',
				content: `Uploaded ${counted(made.length, 'file')}${unlisted ? `; git ignores ${unlisted}, so ${unlisted === 1 ? "it isn't" : "they aren't"} listed` : ''}`,
			});
	}

	dragStart(event, path) {
		if (!this.selected.has(path)) this.select([path]);

		const paths = this.targets(path);

		event.dataTransfer.setData(PATHS_TYPE, JSON.stringify(paths));
		event.dataTransfer.setData('text/plain', paths.join('\n'));
		event.dataTransfer.effectAllowed = 'copyMove';
	}

	// Rows from the list, or files from the computer; `expands` is a closed folder that opens when hovered a moment
	acceptDrops(target, folderOf, { expands = null } = {}) {
		let hover;
		const leave = () => {
			clearTimeout(hover);
			hover = null;
			target.classList.remove('drop-target');
		};

		target.addEventListener('dragover', event => {
			const { types } = event.dataTransfer;
			const ours = types.includes(PATHS_TYPE);

			if (!canType() || !(ours || types.includes('Files'))) return;

			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = ours && !(event.ctrlKey || event.altKey) ? 'move' : 'copy';
			target.classList.add('drop-target');
			if (expands && !hover)
				hover = setTimeout(() => this.panel.reveal(expands, { folder: true, render: true }), EXPAND_ON_HOVER_MS);
		});
		target.addEventListener('dragleave', event => {
			if (!target.contains(event.relatedTarget)) leave();
		});
		target.addEventListener('drop', async event => {
			const ours = event.dataTransfer.getData(PATHS_TYPE);
			const copying = event.ctrlKey || event.altKey;

			if (!canType() || !(ours || event.dataTransfer.types.includes('Files'))) return;

			event.preventDefault();
			event.stopPropagation();
			leave();

			const folder = folderOf();

			if (!ours) return this.upload(await droppedFiles(event.dataTransfer), folder);

			await this.transfer(JSON.parse(ours), folder, { cut: !copying });
		});
	}

	// Arrows walk the list (Shift to select along the way, Right and Left to open and close a folder), Enter opens,
	// F2 renames, Delete deletes, and the clipboard's keys cut, copy and paste
	keydown(event) {
		if (event.target !== this.panel.list) return;

		const paths = this.rows().map(row => row.dataset.entry);
		const at = paths.indexOf(this.cursor);
		const modified = event.ctrlKey || event.metaKey;
		const key = modified ? `Mod+${event.key.toLowerCase()}` : event.key;
		const typing = canType();
		const step = offset => {
			const next = paths[Math.min(Math.max(at + offset, 0), paths.length - 1)];

			if (next === undefined) return;
			if (event.shiftKey) this.selectRange(this.anchor ?? next, next);
			else this.select([next]);
			this.rows()
				.find(row => row.dataset.entry === next)
				?.scrollIntoView({ block: 'nearest' });
		};
		const actions = {
			ArrowDown: () => step(at < 0 ? 0 : 1),
			ArrowUp: () => step(at < 0 ? 0 : -1),
			Home: () => step(-paths.length),
			End: () => step(paths.length),
			ArrowRight: () =>
				this.cursor !== null && this.isFolder(this.cursor) && this.panel.toggleFolder(this.cursor, true),
			ArrowLeft: () => {
				if (this.cursor === null) return;
				if (this.isFolder(this.cursor) && this.panel.expanded.has(this.cursor))
					return this.panel.toggleFolder(this.cursor, false);
				if (parentOf(this.cursor)) this.select([parentOf(this.cursor)]);
			},
			Enter: () => {
				if (this.cursor === null) return;
				if (this.isFolder(this.cursor)) this.panel.toggleFolder(this.cursor);
				else this.panel.open(this.cursor);
			},
			F2: () => typing && this.targets().length === 1 && this.rename(this.targets()[0]),
			Delete: () => typing && this.targets().length && this.delete(this.targets()),
			'Mod+backspace': () => typing && this.targets().length && this.delete(this.targets()),
			'Mod+a': () => this.select(paths, { anchor: paths[0] }),
			'Mod+c': () => this.targets().length && this.toClipboard(this.targets()),
			'Mod+x': () => typing && this.targets().length && this.toClipboard(this.targets(), { cut: true }),
			'Mod+v': () => typing && this.clipboard && this.paste(this.folderAt(this.cursor)),
			Escape: () => {
				if (!this.selected.size && !this.clipboard) return false;
				this.clipboard = null;
				this.select([]);
			},
		};

		if (!actions[key]) return;
		if (actions[key]() === false) return;

		event.preventDefault();
		event.stopPropagation();
	}
}
