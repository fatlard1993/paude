import { expect, test } from 'bun:test';

import { builtChunks, isNewBuild } from './builtChunks';

const served = (js, css) => `<!doctype html><html><head>
<link rel="icon" type="image/svg+xml" href="/favicon-fs0f4grz.svg" />
<link rel="manifest" href="/manifest-kkeskgfb.webmanifest" />
<link rel="stylesheet" crossorigin href="/chunk-${css}.css">
<script type="module" crossorigin src="/chunk-${js}.js"></script>
</head><body></body></html>`;

// The live document as the browser serializes it: attributes reordered and filled in, a stylesheet added at runtime
const loaded = (js, css) => `<html><head>
<link rel="icon" type="image/svg+xml" href="/favicon-fs0f4grz.svg">
<link crossorigin="" href="/chunk-${css}.css" rel="stylesheet">
<script crossorigin="" src="/chunk-${js}.js" type="module"></script>
<link rel="stylesheet" href="https://fonts.example/added.css">
</head><body></body></html>`;

test("a page's code is its scripts and stylesheets, not its icons or manifest", () => {
	expect([...builtChunks(served('aaa', 'bbb'))]).toEqual(['/chunk-bbb.css', '/chunk-aaa.js']);
});

test('the same build served again is not a new version, however the browser wrote the page down', () => {
	expect(isNewBuild(served('aaa', 'bbb'), loaded('aaa', 'bbb'))).toBe(false);
});

test('a changed script or stylesheet is a new version', () => {
	expect(isNewBuild(served('ccc', 'bbb'), loaded('aaa', 'bbb'))).toBe(true);
	expect(isNewBuild(served('aaa', 'ddd'), loaded('aaa', 'bbb'))).toBe(true);
});

test('a page served with no code in it is not offered', () => {
	expect(isNewBuild('<html></html>', loaded('aaa', 'bbb'))).toBe(false);
});
