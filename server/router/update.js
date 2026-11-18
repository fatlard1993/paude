import { requestMatch } from '@vanilla-bean/components/app';

import { UpdateError, startUpdate, updateState } from '../selfUpdate';

// The machine's paude itself: how it stands against what it would pull, and updating it. Under /api/machine, so
// only the owner reaches it, and another paude's is reached through this one as its files and shell are.
const updateRoutes = async request => {
	if (requestMatch('GET', '/api/machine/update', request)) {
		const fresh = new URL(request.url).searchParams.has('fresh');

		return Response.json(await updateState({ fresh }));
	}

	if (requestMatch('POST', '/api/machine/update', request)) {
		try {
			await startUpdate();
		} catch (error) {
			if (error instanceof UpdateError) return new Response(error.message, { status: 409 });
			throw error;
		}

		return Response.json(await updateState());
	}

	return null;
};

export default updateRoutes;
