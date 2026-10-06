import { describe, test, expect } from 'bun:test';
import requestMatch from './requestMatch.js';

const makeRequest = (method, url) => ({ method, url: `http://host${url}` });

describe('requestMatch', () => {
	test('returns false on method mismatch', () => {
		expect(requestMatch('GET', '/bookmarks', makeRequest('POST', '/bookmarks'))).toBe(false);
	});

	test('matches exact path with no params', () => {
		expect(requestMatch('GET', '/bookmarks', makeRequest('GET', '/bookmarks'))).toEqual({});
	});

	test('returns false for non-matching path', () => {
		expect(requestMatch('GET', '/bookmarks', makeRequest('GET', '/categories'))).toBe(false);
	});

	test('returns false when path has extra trailing segments', () => {
		expect(requestMatch('GET', '/bookmarks', makeRequest('GET', '/bookmarks/extra'))).toBe(false);
	});

	test('extracts a single route param', () => {
		expect(requestMatch('GET', '/bookmarks/:id', makeRequest('GET', '/bookmarks/abc123'))).toEqual({ id: 'abc123' });
	});

	test('extracts multiple route params', () => {
		const result = requestMatch('GET', '/search/:provider/:term', makeRequest('GET', '/search/google/cats'));
		expect(result).toEqual({ provider: 'google', term: 'cats' });
	});

	test('decodes percent-encoded route params', () => {
		const result = requestMatch('GET', '/bookmarks/:id', makeRequest('GET', '/bookmarks/hello%20world'));
		expect(result).toEqual({ id: 'hello world' });
	});

	test('includes query string params in result', () => {
		expect(requestMatch('GET', '/bookmarks', makeRequest('GET', '/bookmarks?page=2'))).toEqual({ page: '2' });
	});

	test('merges route params and query string params', () => {
		const result = requestMatch('GET', '/bookmarks/:id', makeRequest('GET', '/bookmarks/abc?foo=bar'));
		expect(result).toEqual({ id: 'abc', foo: 'bar' });
	});

	test('does not match partial path prefix', () => {
		expect(requestMatch('GET', '/book', makeRequest('GET', '/bookmarks'))).toBe(false);
	});

	test('matches nested path with no params', () => {
		expect(requestMatch('GET', '/search/engines', makeRequest('GET', '/search/engines'))).toEqual({});
	});

	test('escapes regex special chars in literal segments', () => {
		expect(requestMatch('GET', '/v1.0/resource', makeRequest('GET', '/v1X0/resource'))).toBe(false);
		expect(requestMatch('GET', '/v1.0/resource', makeRequest('GET', '/v1.0/resource'))).toEqual({});
	});
});
