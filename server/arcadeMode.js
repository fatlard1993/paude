import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';

// Arcade as a way of using any session: big talk, read aloud, a choice to end each turn. Each session can be switched
// into it or out of it ({ on, reading }, kept here); a session never switched takes its project's default, which is
// on in a project that carries the arcade's marker (a game paude made, or a project brought into the arcade).
let file;
let modes = {};

export const initArcadeMode = async dataDir => {
	file = path.join(dataDir, 'session-arcade.json');
	modes = await readJsonFile(file, {});
};

// What the session was switched to, or null when it never was
export const arcadeModeOf = id => modes[id] ?? null;

// `on`: whether it's in the arcade; `reading`: how Claude writes there (one of READING's keys)
export const setArcadeMode = async (id, { on, reading }) => {
	modes[id] = { on: Boolean(on), ...(reading && { reading }) };
	if (file) await writeJsonFile(file, () => modes);
};

export const forgetArcadeMode = async id => {
	if (!(id in modes)) return;
	delete modes[id];
	if (file) await writeJsonFile(file, () => modes);
};
