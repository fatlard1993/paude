#!/usr/bin/env bun
// Stands in for claude -p --model haiku describing links: each numbered link is "about" its address's last part
const prompt = await Bun.stdin.text();
const links = [...prompt.matchAll(/^(\d+)\. (\S+)/gm)];

process.stdout.write(
	`\`\`\`json\n${JSON.stringify(Object.fromEntries(links.map(([, number, url]) => [number, `about ${url.split('/').pop()}.`])))}\n\`\`\`\n`,
);
