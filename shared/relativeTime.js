const relativeTime = time => {
	if (!time) return '';

	const minutes = Math.round((Date.now() - time) / 60_000);

	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;

	return `${Math.round(minutes / 60 / 24)}d ago`;
};

export default relativeTime;
