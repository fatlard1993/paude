import { relativeTime } from '@vanilla-bean/components/utils/date';
import { button, closeButton, element, icon } from '../dom';
import { canNote, identity } from '../identity';
import Panel from './GitPanel.styles';

const TABS = [
	['open', 'Unrecorded'],
	['placed', 'Recorded'],
];
const KIND_ICONS = { decision: 'scale-balanced', direction: 'signs-post', deferred: 'hourglass-half' };
const KIND_LABELS = { decision: 'Decided', direction: 'Direction', deferred: 'Put off' };
const READING_MS = 4000;

// What the session settled (decisions, directions, work put off), and whether each is recorded anywhere: a commit,
// an instruction file, a design document. What isn't leads; paude files what it can into the open commit it shaped,
// asks the owner what it can't settle from the conversation, and the owner can ask Claude to record one where it
// belongs. Anyone with notes can set one aside as not worth it.
export default class DecisionsPanel extends Panel {
	// Set here rather than as class fields: VBC runs build() from its own constructor, before subclass fields exist
	build() {
		this.tab = 'open';
		this.decisions = [];
		this.bar = element('div', 'bar');
		this.filters = element('div', 'tabs links-filters');
		this.search = element('input', 'link-search');
		this.body = element('div', 'body');
		this.search.placeholder = 'Find something settled here';
		this.search.addEventListener('input', () => this.renderDecisions());
		this.bar.append(
			element('span', 'branch', 'Decisions'),
			element('span', 'spacer'),
			closeButton(() => this.options.close()),
		);
		this.elem.tabIndex = -1;
		this.elem.append(this.bar, this.filters, this.search, this.body);
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.target === this.search) return;

			event.stopPropagation();
			this.options.close();
		});
	}

	async refresh() {
		const { body, response } = await this.options.load();

		if (!response?.ok) {
			this.body.replaceChildren(element('div', 'empty', 'Could not read what was settled.'));
			this.read = null;

			return;
		}

		// Read again while Claude works: drawn again only when something changed, so a quiet one holds still
		const read = JSON.stringify(body);

		if (read !== this.read) {
			this.read = read;
			this.reading = body.reading;
			this.decisions = body.decisions;
			this.renderDecisions();
		}
		// Haiku is still reading turns, looking for where some are recorded, or filing them: look again shortly, while
		// it's showing
		clearTimeout(this.again);
		if (body.reading || body.decisions.some(decision => decision.looking || decision.filing))
			this.again = setTimeout(() => this.showing() && this.refresh(), READING_MS);
	}

	showing() {
		return this.elem.isConnected && this.elem.classList.contains('open');
	}

	renderDecisions() {
		const query = this.search.value.trim().toLowerCase();
		const inTab = tab => this.decisions.filter(decision => (tab === 'placed') === Boolean(decision.place));

		this.filters.replaceChildren(
			...TABS.map(([tab, label]) => {
				const filter = button(
					`${label} ${inTab(tab).length}`,
					() => {
						this.tab = tab;
						this.renderDecisions();
					},
					{ className: 'variant-flat' },
				);

				filter.classList.toggle('active', tab === this.tab);

				return filter;
			}),
		);

		const list = inTab(this.tab).filter(
			decision =>
				!query ||
				[decision.chose, decision.rejected, decision.because, decision.asked].some(text =>
					text?.toLowerCase().includes(query),
				),
		);
		const empty =
			this.reading && !this.decisions.length
				? 'Reading the conversation for what it settled…'
				: {
						open: 'Nothing settled here waits to be recorded.',
						placed: 'Nothing settled here is recorded yet.',
					}[this.tab];

		this.body.replaceChildren(
			...(list.length ? list.map(decision => this.row(decision)) : [element('div', 'empty', empty)]),
			...(this.reading && this.decisions.length ? [element('div', 'meta', 'Still reading the latest turns…')] : []),
		);
	}

	row(decision) {
		const row = element('div', 'link decision');
		const head = element('div', 'link-head');

		head.append(icon(KIND_ICONS[decision.kind]), element('span', 'name', decision.chose));
		if (!decision.place && identity()?.owner) {
			const write = button('', () => this.writeDown(decision, write), {
				icon: 'pen-to-square',
				title: 'Ask Claude to record it where it belongs',
				className: 'icon-only',
			});

			head.append(write);
		}
		if (canNote())
			head.append(
				button('', () => this.dismiss(decision), {
					icon: 'eye-slash',
					title: 'Set it aside: not worth writing down',
					className: 'icon-only',
				}),
			);

		row.append(
			head,
			...(decision.rejected ? [this.said('Rejected', decision.rejected)] : []),
			...(decision.because ? [this.said('Because', decision.because)] : []),
			...(decision.question ? [this.said('To file it, paude asks', decision.question)] : []),
			...(decision.question && identity()?.owner ? [this.answerForm(decision)] : []),
			element('div', 'link-address', `❯ ${decision.asked}`),
			element(
				'div',
				'meta',
				[
					KIND_LABELS[decision.kind],
					decision.at && relativeTime(Date.parse(decision.at)),
					decision.place
						? `${decision.filed ? 'filed into' : 'recorded in'} ${decision.place}`
						: (decision.filing && 'filing it into its commit…') ||
							(decision.looking && 'looking for where it is recorded…'),
				]
					.filter(Boolean)
					.join(' · '),
			),
		);

		return row;
	}

	said(label, text) {
		const line = element('div', 'link-context');

		line.append(element('span', 'said-by', `${label}: `), text);

		return line;
	}

	// The answer goes into the commit's message when it's offered to it again
	answerForm(decision) {
		const form = element('form', 'decision-answer');
		const input = element('input', 'link-search');
		// A button in a form submits it
		const send = button('Answer', () => {});

		input.placeholder = 'Your answer';
		form.append(input, send);
		form.addEventListener('submit', async event => {
			event.preventDefault();
			if (!input.value.trim()) return;
			send.disabled = true;
			await this.options.answer(decision.id, input.value.trim());
			await this.refresh();
		});

		return form;
	}

	async writeDown(decision, write) {
		write.disabled = true;
		await this.options.writeDown(decision.id);
		write.title = 'Asked: Claude records it when its prompt box is free';
	}

	async dismiss(decision) {
		await this.options.dismiss(decision.id);
		await this.refresh();
	}
}
