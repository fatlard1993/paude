import { button, element } from '../dom';

// Steps through a tour, any kind: its overview first (with whether what changed was tested since, and what it
// leaves out), then a stop at a time, Back and Next
// between them. `place(stop)` takes the reader to a stop (null for the overview), returning any details and actions
// to show with it.
const stepThrough = ({ into, heading, overview, stops, leftOut = [], checked, stopTitle, place, close }) => {
	const show = index => {
		const stop = stops[index - 1];
		const answers = element('div', 'answers');
		const { details, actions = [] } = place(stop ?? null) || {};

		into.replaceChildren(
			element('div', 'title', index === 0 ? heading : stopTitle(stop, index)),
			element('div', 'question', index === 0 ? overview : stop.text),
			...(index === 0 && checked ? [element('div', 'details', checked)] : []),
			...(index === 0 && leftOut.length ? [element('div', 'details', `Not in it: ${leftOut.join(' ')}`)] : []),
			...(details ? [element('div', 'details', details)] : []),
		);
		answers.append(...actions);
		if (index > 0) answers.append(button('Back', () => show(index - 1)));
		if (index < stops.length) answers.append(button(index === 0 ? 'Start the tour' : 'Next', () => show(index + 1)));
		answers.append(button(index === stops.length && index > 0 ? 'Done' : 'Close', () => close(index > 0)));
		into.append(answers);
	};

	show(0);
};

export default stepThrough;
