// What the side terminal runs to edit a file: the editor the person named, when it's one that runs in a terminal
// ($VISUAL and $EDITOR often name a desktop editor, like `code`, that can't), or the first terminal editor installed.
// sh splits an editor named with its options (`nvim -p`), which zsh wouldn't.
const SCRIPT = [
	'for named in "$PAUDE_EDITOR" "$VISUAL" "$EDITOR"; do',
	'case "${named##*/}" in nvim*|vim*|vi|vi\\ *|nano*|micro*|hx*|helix*|kak*|emacs*-nw*|mg*|joe*|ne) exec $named "$1";; esac',
	'done',
	'for installed in nvim vim nano vi; do command -v "$installed" >/dev/null && exec "$installed" "$1"; done',
	'echo "No terminal editor found: set PAUDE_EDITOR."; sleep 3',
].join('\n');

const quoted = text => `'${text.replace(/'/g, `'\\''`)}'`;

const editCommand = path => `exec sh -c ${quoted(SCRIPT)} editor ${quoted(path)}`;

export default editCommand;
