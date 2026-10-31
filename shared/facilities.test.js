import { expect, test } from 'bun:test';

import { CORE_FACILITIES, facilitiesFor, facilityOf } from './facilities';

test('each tool is used at its facility, an MCP server its own', () => {
	expect(facilityOf('Grep')).toBe('library');
	expect(facilityOf('Edit')).toBe('forge');
	expect(facilityOf('Bash')).toBe('reactor');
	expect(facilityOf('mcp__claude_ai_Claude_Docs__batch')).toBe('mcp:claude_ai_Claude_Docs');
	expect(facilityOf('SomethingNew')).toBe('outpost');
	expect(facilityOf(null)).toBeNull();
});

test('a machine has the core facilities, then its MCP servers in order, and an outpost only once one was used', () => {
	expect(facilitiesFor([])).toEqual(CORE_FACILITIES);

	const keys = facilitiesFor(['mcp__zeta__a', 'Read', 'mcp__alpha__b', 'mcp__zeta__c']).map(({ key }) => key);

	expect(keys.slice(CORE_FACILITIES.length)).toEqual(['mcp:alpha', 'mcp:zeta']);
	expect(facilitiesFor(['Mystery']).at(-1).key).toBe('outpost');
});
