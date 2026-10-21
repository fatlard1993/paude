// What a file indents with: tabs, or spaces in fours, or in twos when its indents don't all come in fours.
// Tabs for a file that doesn't say.
const indentation = text => {
	let tabs = 0;
	let spaced = 0;
	let fours = 0;

	for (const line of text.split('\n', 10_000)) {
		if (line.startsWith('\t')) tabs += 1;
		else {
			const width = /^ +(?=\S)/.exec(line)?.[0].length;

			if (!width) continue;
			spaced += 1;
			if (width % 4 === 0) fours += 1;
		}
	}

	if (spaced <= tabs) return '\t';

	return fours === spaced ? '    ' : '  ';
};

export default indentation;
