const requestMatch = (method, pattern, request) => {
	if (method !== request.method) return false;

	const url = new URL(request.url);
	const path = url.pathname;

	const result = {};

	for (const [key, value] of url.searchParams.entries()) result[key] = value;

	if (!pattern.includes(':')) return path === pattern && result;

	const paramNames = [];
	const regexStr = pattern
		.split('/')
		.map(segment => {
			if (segment.startsWith(':')) {
				paramNames.push(segment.slice(1));
				return '([^/]+)';
			}
			return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		})
		.join('\\/');

	const values = new RegExp(`^${regexStr}$`).exec(path)?.slice(1);

	if (!values) return false;

	paramNames.forEach((key, index) => {
		result[key] = decodeURIComponent(values[index]);
	});

	return result;
};

export default requestMatch;
