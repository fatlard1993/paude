// How Claude writes to the person building an arcade game, offered when the game is made: plain text, or for someone
// who'd rather listen, simple words read aloud, or everything spoken
export const READING = {
	listening: { label: 'Spoken aloud', detail: 'everything said aloud and written to be heard: no reading needed' },
	learning: { label: 'Simple and read aloud', detail: 'short, common words, said aloud and shown big' },
	reading: { label: 'Plain text', detail: 'plain, concise writing' },
};

// Whether an arcade's talk is read aloud: as whoever's at it last chose for that way of writing (`kept`, 'yes' or
// 'no'), else as the way itself has it: aloud for the two that are written to be heard, silent for plain text, which
// was chosen to be read
export const readAloudFor = (reading, kept) =>
	kept === 'yes' || kept === 'no' ? kept === 'yes' : reading !== 'reading';

// Whether a prompt as it's sent is a new game, made at once with nothing looked for: sent to the arcade (`arcade`, a
// way of writing) with no project named, here or on another paude. Named for a project, it's that project's to place.
export const makesGame = ({ arcade, project, remote }) => arcade in READING && !project && !remote;
