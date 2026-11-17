// Work a session left running when its turn ended (a command run in the background, an agent sent off), that Claude
// will be woken by: `background` is how many, or a list of them
const countOf = background => (Array.isArray(background) ? background.length : Number(background) || 0);

export const awaitingBackground = session => session.status === 'ready' && countOf(session.background) > 0;

export const backgroundWords = background =>
	`waiting on ${countOf(background) === 1 ? 'one thing' : `${countOf(background)} things`} in the background`;
