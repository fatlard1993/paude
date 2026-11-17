import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';

// A terminal's characters measured as Claude Code measures them, a joined emoji (🤷‍♂️) one two-cell character rather than
// its pieces: the browser's terminals and the server's mirror of each alike, so a line is as wide in each
export const measureGraphemes = terminal => terminal.loadAddon(new UnicodeGraphemesAddon());
