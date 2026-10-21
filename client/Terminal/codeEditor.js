import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { Compartment, EditorState } from '@codemirror/state';
import {
	EditorView,
	drawSelection,
	dropCursor,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { bracketMatching, indentUnit } from '@codemirror/language';
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';

import commentTokens from '../../shared/commentTokens';
import indentation from '../../shared/indentation';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// The find bar in the words and toggles the project search uses
const PHRASES = {
	Find: 'Find',
	Replace: 'Replace with',
	next: 'Next',
	previous: 'Previous',
	all: 'All',
	'match case': 'Aa',
	regexp: '.*',
	'by word': 'ab',
	replace: 'Replace',
	'replace all': 'Replace all',
	close: 'Close',
	'Go to line': 'Go to line',
	go: 'Go',
};

const wrapping = new Compartment();

// Tab at a cursor types one of the file's own indents; with something selected, it indents the lines
const tab = view => {
	if (view.state.selection.ranges.some(range => !range.empty)) return indentMore(view);

	view.dispatch(
		view.state.update(view.state.replaceSelection(view.state.facet(indentUnit)), {
			scrollIntoView: true,
			userEvent: 'input',
		}),
	);

	return true;
};

const TOGGLE_NAMES = { case: 'Match case', word: 'Match whole word', re: 'Use regular expression' };

// The toggles show short, as the project search's do; each is named in full for a pointer or a screen reader
const nameToggles = EditorView.updateListener.of(update => {
	for (const input of update.view.dom.querySelectorAll('.cm-search input[type=checkbox]:not([aria-label])')) {
		input.setAttribute('aria-label', TOGGLE_NAMES[input.name]);
		input.closest('label').title = TOGGLE_NAMES[input.name];
	}
});

// The editor keys people bring from VS Code and Sublime: Ctrl+F finds and Ctrl+H (Cmd+Alt+F) replaces, Ctrl+G goes to
// a line, Ctrl+D picks the next occurrence, Ctrl+Shift+L all of them, Alt+click adds a cursor and Ctrl+Alt+Up/Down one
// a line away, Shift+Alt+drag selects a column, Alt+Up/Down moves the line, Ctrl+/ comments it out, Alt+Z wraps
// long lines. The syntax font colors the text, as it does in the source view, so CodeMirror's own highlighting isn't
// used.
const editorKeys = ({ onSave, onWrap }) => [
	{ key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) },
	{ key: 'Mod-h', mac: 'Mod-Alt-f', preventDefault: true, run: openSearchPanel },
	{ key: 'Mod-g', preventDefault: true, run: gotoLine },
	{
		key: 'Alt-z',
		preventDefault: true,
		run: view => {
			const on = wrapping.get(view.state) !== EditorView.lineWrapping;

			view.dispatch({ effects: wrapping.reconfigure(on ? EditorView.lineWrapping : []) });
			onWrap(on);

			return true;
		},
	},
	{ key: 'Tab', run: tab, shift: indentLess },
	...closeBracketsKeymap,
	...searchKeymap,
	...historyKeymap,
	...defaultKeymap,
];

// `state` carries an edit (its text, cursors and undo history) across the panel drawing the editor again
export const createState = (text, { path, language, wrap = false, onUpdate, onSave, onWrap }) => {
	const comments = commentTokens(path);

	return EditorState.create({
		doc: text,
		extensions: [
			lineNumbers(),
			highlightActiveLineGutter(),
			highlightSpecialChars(),
			history(),
			drawSelection(),
			dropCursor(),
			EditorState.allowMultipleSelections.of(true),
			EditorView.clickAddsSelectionRange.of(event => event.altKey || (MAC ? event.metaKey : event.ctrlKey)),
			rectangularSelection({ eventFilter: event => event.altKey && event.shiftKey }),
			highlightActiveLine(),
			highlightSelectionMatches(),
			closeBrackets(),
			bracketMatching(),
			search({ top: true }),
			indentUnit.of(indentation(text)),
			EditorState.tabSize.of(4),
			EditorState.phrases.of(PHRASES),
			...(comments ? [EditorState.languageData.of(() => [{ commentTokens: comments }])] : []),
			wrapping.of(wrap ? EditorView.lineWrapping : []),
			EditorView.darkTheme.of(true),
			EditorView.contentAttributes.of({ class: language ? `language-${language}` : 'plain', spellcheck: 'false' }),
			EditorView.updateListener.of(onUpdate),
			nameToggles,
			keymap.of(editorKeys({ onSave, onWrap })),
		],
	});
};

export const codeEditor = state => {
	const view = new EditorView({ state });

	// Esc closes the find bar or drops the extra cursors; it never reaches the panel, which would close
	view.dom.addEventListener('keydown', event => event.key === 'Escape' && event.stopPropagation());

	return view;
};

export { openSearchPanel };
