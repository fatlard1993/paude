import { getTimeline, getVerification } from '../api';
import { button, closeButton, element, icon } from '../dom';
import relativeTime from '../../shared/relativeTime';
import Panel from './GitPanel.styles';

const TOOL_ICONS = {
	Read: 'eye',
	Edit: 'pen',
	MultiEdit: 'pen',
	Write: 'file-pen',
	NotebookEdit: 'pen',
	Bash: 'terminal',
	Grep: 'magnifying-glass',
	Glob: 'folder-open',
	WebFetch: 'globe',
	WebSearch: 'globe',
	Task: 'diagram-project',
	Agent: 'diagram-project',
	TodoWrite: 'list-check',
};

const tokens = count => (count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

const duration = (from, to) => {
	const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));

	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

// What Claude did, turn by turn: each prompt with the tools Claude used for it, in order, and how full its context
// is. An edit opens the turn's changes, a read the file it read, and a command shows what it printed.
export default class ActivityPanel extends Panel {
	// Set here rather than as class fields: VBC runs build() from its own constructor, before subclass fields exist
	build() {
		this.opened = new Set();
		this.bar = element('div', 'bar');
		this.context = element('span', 'tracking');
		this.body = element('div', 'body');
		this.bar.append(
			element('span', 'branch', 'Activity'),
			this.context,
			element('span', 'spacer'),
			closeButton(() => this.options.close()),
		);
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;

			event.stopPropagation();
			this.options.close();
		});
	}

	async refresh() {
		const [{ body, response }, checked] = await Promise.all([
			getTimeline(this.options.sessionId),
			getVerification(this.options.sessionId),
		]);

		if (!response?.ok) {
			this.body.replaceChildren(element('div', 'empty', 'Could not read what Claude did.'));

			return;
		}

		this.context.textContent = body.context ? `context ${tokens(body.context.tokens)} tokens` : '';
		this.context.title = body.context
			? `${body.context.tokens.toLocaleString()} tokens in the last request (${body.context.model})`
			: '';
		// Open the newest turn, unless a turn was opened by hand
		if (!this.opened.size && body.turns[0]) this.opened.add(body.turns[0].id);
		this.verdict = checked.response?.ok ? checked.body : null;
		this.renderTurns(body.turns);
	}

	// One turn opened and scrolled to, as the catch-up tour does for a turn the terminal no longer holds
	async focusTurn(id) {
		this.opened = new Set([id]);
		this.focused = id;
		await this.refresh();

		const node = this.body.querySelector(`[data-turn="${CSS.escape(id)}"]`);

		node?.scrollIntoView({ block: 'start' });
	}

	renderTurns(turns) {
		const scroll = this.body.scrollTop;

		this.body.replaceChildren(
			...(this.verdict ? [element('div', `verdict ${this.verdict.state}`, this.verdict.said)] : []),
			...(turns.length ? turns.map(turn => this.turn(turn)) : [element('div', 'empty', 'Nothing yet.')]),
		);
		this.body.scrollTop = scroll;
	}

	turn(turn) {
		const node = element('div', `turn${turn.id === this.focused ? ' focused' : ''}`);

		node.dataset.turn = turn.id;
		const head = element('button', 'turn-head variant-flat');
		const edited = new Set(turn.steps.filter(step => step.edits).map(step => step.file));
		const failed = turn.steps.filter(step => step.ok === false && !step.declined).length;
		const meta = [
			relativeTime(Date.parse(turn.at)),
			duration(turn.at, turn.endedAt),
			`${turn.steps.length} step${turn.steps.length === 1 ? '' : 's'}`,
			edited.size && `${edited.size} file${edited.size === 1 ? '' : 's'} edited`,
			failed && `${failed} failed`,
			turn.steps.some(step => step.declined) && 'a step turned down',
			turn.interrupted && 'interrupted',
		].filter(Boolean);

		head.append(element('div', 'subject', turn.prompt || '(no words)'), element('div', 'meta', meta.join(' · ')));
		head.addEventListener('click', () => {
			if (this.opened.has(turn.id)) this.opened.delete(turn.id);
			else this.opened.add(turn.id);
			node.replaceWith(this.turn(turn));
		});
		node.append(head);

		if (this.opened.has(turn.id)) {
			const steps = element('div', 'steps');

			for (const step of turn.steps) steps.append(this.step(step, turn));
			if (edited.size)
				steps.append(
					button(`Show this turn's changes`, () => this.options.openDiff({ source: 'turn', turn: turn.id }), {
						className: 'more',
					}),
				);
			node.append(steps);
		}

		return node;
	}

	step(step, turn) {
		const row = element('div', `step${step.ok === false ? ' failed' : ''}${step.ok === undefined ? ' running' : ''}`);
		const line = element('button', 'step-line variant-flat');
		const output = element('pre', 'step-output', step.output ?? '');

		line.append(
			icon(TOOL_ICONS[step.tool] ?? 'wrench'),
			element('span', 'tool', step.tool),
			element('span', 'what', step.summary ?? ''),
		);
		line.title = step.command ?? step.summary ?? step.tool;
		output.hidden = true;
		line.addEventListener('click', () => {
			if (step.edits && step.file) return this.options.openDiff({ source: 'turn', turn: turn.id });
			if (step.file && !step.file.startsWith('/')) return this.options.openFile(step.file, step.line);

			output.hidden = !output.hidden;
		});
		row.append(line, output);

		return row;
	}
}
