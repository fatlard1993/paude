// A JSON file's contents, or a fresh copy of the fallback when it doesn't exist yet
const readJsonFile = async (file, fallback) => {
	const stored = Bun.file(file);

	return (await stored.exists()) ? stored.json() : structuredClone(fallback);
};

export default readJsonFile;
