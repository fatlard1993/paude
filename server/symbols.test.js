import { expect, test } from 'bun:test';

import { symbolsIn } from './symbols';

const names = (text, file) => symbolsIn(text, file).map(({ name, kind, line }) => `${kind} ${name} ${line}`);

test('JavaScript and TypeScript: functions, classes, types, top-level values and methods, not locals', () => {
	const source = [
		'export const LIMIT = 3;',
		'export const run = async (a, b) => {',
		'	const local = 1;',
		'	if (a) {',
		'};',
		'export default class Panel extends Thing {',
		'	async refresh(force) {',
		'	}',
		'}',
		'export interface Options {}',
		'function helper() {}',
	].join('\n');

	expect(names(source, 'a.ts')).toEqual([
		'value LIMIT 1',
		'function run 2',
		'class Panel 6',
		'method refresh 7',
		'type Options 10',
		'function helper 11',
	]);
});

test('Python, Go, Rust, Ruby and shell', () => {
	expect(names('class Shop:\n    def total(self):\n        pass\nLIMIT = 3', 'a.py')).toEqual([
		'class Shop 1',
		'function total 2',
		'value LIMIT 4',
	]);
	expect(names('func (s *Shop) Total() int {\ntype Shop struct {', 'a.go')).toEqual([
		'function Total 1',
		'type Shop 2',
	]);
	expect(names('pub async fn serve() {}\npub(crate) struct Shop;', 'a.rs')).toEqual([
		'function serve 1',
		'type Shop 2',
	]);
	expect(names('module Billing\n  def self.charge', 'a.rb')).toEqual(['class Billing 1', 'function charge 2']);
	expect(names('deploy() {\nfunction build {', 'a.sh')).toEqual(['function deploy 1']);
});

test("a file of a language it doesn't know has no symbols", () => {
	expect(symbolsIn('anything', 'a.xyz')).toEqual([]);
});
