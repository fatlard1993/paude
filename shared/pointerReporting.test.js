import { expect, test } from 'bun:test';

import withoutPointerReporting from './pointerReporting';

test('mouse and focus reporting switches are removed, other modes and text stay', () => {
	expect(withoutPointerReporting('\x1b[?1004h')).toBe('');
	expect(withoutPointerReporting('a\x1b[?1000h\x1b[?1006hb')).toBe('ab');
	expect(withoutPointerReporting('\x1b[?1002;1006;2004h')).toBe('\x1b[?2004h');
	expect(withoutPointerReporting('\x1b[?25l\x1b[?1003l')).toBe('\x1b[?25l');
	expect(withoutPointerReporting('\x1b[31mred\x1b[0m')).toBe('\x1b[31mred\x1b[0m');
});

test('reports the pointer modes it drops', () => {
	const seen = [];

	withoutPointerReporting('\x1b[?1000;1006;25h\x1b[?1000l', (mode, on) => seen.push(`${mode}:${on}`));
	expect(seen).toEqual(['1000:true', '1006:true', '1000:false']);
});
