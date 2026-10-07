// A phone's keyboard covers the bottom of the page rather than shrinking it (on iOS always, on Android unless the
// viewport meta asks), which hides the key bar and the prompt behind it. The page keeps to the part still showing,
// except while pinch-zoomed, when that part is a magnified piece of the page and not the page.
const fitToKeyboard = () => {
	const visible = window.visualViewport;

	if (!visible) return;

	const fit = () => {
		document.documentElement.style.height = visible.scale > 1.01 ? '' : `${visible.height}px`;
		if (visible.scale <= 1.01 && window.scrollY) window.scrollTo(0, 0);
	};

	visible.addEventListener('resize', fit);
	visible.addEventListener('scroll', fit);
	fit();
};

export default fitToKeyboard;
