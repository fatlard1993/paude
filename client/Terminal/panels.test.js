import { expect, test } from 'bun:test';

import { panelLabel, panelTitle, sectionsOf } from './panels';

const OWNER = ['activity', 'decisions', 'tasks', 'shares', 'artifacts', 'links', 'people'];

test("a grouped panel's button is the group's, its sections those the viewer has, in the group's order", () => {
	expect(sectionsOf('decisions', OWNER)).toEqual(['activity', 'decisions']);
	expect(sectionsOf('shares', OWNER)).toEqual(['tasks', 'shares']);
	expect(panelLabel('links', OWNER)).toBe('Made');
	expect(panelTitle('activity', OWNER)).toStartWith('Record: ');
});

test('a panel the viewer has alone of its group, or in none, keeps its own name', () => {
	expect(sectionsOf('shares', ['shares'])).toEqual(['shares']);
	expect(panelLabel('shares', ['shares'])).toBe('Shared');
	expect(panelLabel('tasks', ['files', 'tasks', 'git'])).toBe('Tasks');
	expect(panelTitle('tasks', ['files', 'tasks'])).toStartWith("Tasks: the project's checks");
	expect(sectionsOf('people', OWNER)).toEqual(['people']);
});
