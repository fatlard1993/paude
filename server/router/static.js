import { resolve, sep } from 'path';

// The page pulls its fonts and icon CSS straight from these packages; nothing else in node_modules is served
const PUBLIC_PACKAGE_FILES = [
	'/@fortawesome/fontawesome-free/',
	'/@fontsource-variable/kode-mono/',
	'/@vanilla-bean/components/FontWithASyntaxHighlighter-Regular.woff2',
];

const safeFile = (base, pathname) => {
	const root = resolve(base);
	const resolved = resolve(root, `.${pathname}`);

	if (resolved !== root && !resolved.startsWith(root + sep)) return null;

	return Bun.file(resolved);
};

const staticRouter = async request => {
	const pathname = decodeURIComponent(new URL(request.url).pathname);

	let file = safeFile('client/build', pathname);
	if (file && (await file.exists())) return new Response(file);

	// Checked on the resolved path, so ..%2f can't step from an allowed package into another
	const resolved = resolve('node_modules', `.${pathname}`).slice(resolve('node_modules').length);

	if (!PUBLIC_PACKAGE_FILES.some(allowed => resolved.startsWith(allowed))) return null;

	file = safeFile('node_modules', pathname);
	if (file && (await file.exists())) return new Response(file);

	return null;
};

export default staticRouter;
