// Back goes where this tab came from: an earlier page of this paude, or the paude that handed it here. A tab opened
// straight onto a page (a notification, paude web) has nowhere of ours to go back to, so it gets `fallback`.
let movedWithin = false;
const handedFrom = document.referrer && new URL(document.referrer).origin !== window.location.origin;

window.addEventListener('hashchange', ({ oldURL }) => {
	// Arriving by an invite or a handoff swaps out its own address; that's not a page to go back to
	if (!/#\/(join|handoff)\//.test(oldURL)) movedWithin = true;
});

const goBack = fallback => {
	if (movedWithin || handedFrom) window.history.back();
	else window.location.hash = fallback;
};

export default goBack;
