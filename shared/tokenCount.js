// A token count in a few characters: 840, 39k, 1.6M
const tokenCount = count => {
	if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;

	return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
};

export default tokenCount;
