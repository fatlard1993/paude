const tags = /<(?:script|link)\b[^>]*>/gi;

// The code a page of paude runs: its module scripts and stylesheets, named by the hash of what they hold
export const builtChunks = html =>
	new Set(
		(html.match(tags) ?? []).flatMap(tag => {
			const isCode = /^<script/i.test(tag) || /\brel=["']?stylesheet\b/i.test(tag);
			const [, ref] = tag.match(/\b(?:src|href)=["']?([^"'\s>]+)/i) ?? [];

			return isCode && ref ? [ref] : [];
		}),
	);

// Newer only when what's served now names code the page never loaded; a rebuild of the same files, or a socket that
// dropped and came back, changes nothing
export const isNewBuild = (servedHtml, loadedHtml) => {
	const loaded = builtChunks(loadedHtml);

	return [...builtChunks(servedHtml)].some(chunk => !loaded.has(chunk));
};
