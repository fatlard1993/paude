// A zip of files, streamed as it's made: stored rather than compressed (build output is mostly compressed already,
// and storing needs nothing but a CRC), names in UTF-8. Without zip64, so it stops short of 4GB.
const LIMIT = 0xffffffff;

const dosTime = date =>
	((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
const dosDate = date => (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;

const header = (size, write) => {
	const bytes = new Uint8Array(size);

	write(new DataView(bytes.buffer));

	return bytes;
};

// The zip's bytes, piece by piece, for `entries`: an async iterable of
// { name, modified: Date, bytes: () => Promise<Uint8Array> }
const zipChunks = async function* zipChunks(entries) {
	const central = [];
	let offset = 0;
	const counted = bytes => {
		offset += bytes.length;

		return bytes;
	};

	for await (const entry of entries) {
		const name = new TextEncoder().encode(entry.name);
		const data = await entry.bytes();
		const crc = Bun.hash.crc32(data) >>> 0;
		const time = dosTime(entry.modified);
		const date = dosDate(entry.modified);

		if (offset + data.length + 30 + name.length > LIMIT) throw new Error('Too big to zip here');

		central.push({ name, crc, size: data.length, time, date, at: offset });
		yield counted(
			header(30, view => {
				view.setUint32(0, 0x04034b50, true);
				view.setUint16(4, 20, true);
				view.setUint16(6, 0x0800, true);
				view.setUint16(10, time, true);
				view.setUint16(12, date, true);
				view.setUint32(14, crc, true);
				view.setUint32(18, data.length, true);
				view.setUint32(22, data.length, true);
				view.setUint16(26, name.length, true);
			}),
		);
		yield counted(name);
		yield counted(data);
	}

	const start = offset;

	for (const { name, crc, size, time, date, at } of central) {
		yield counted(
			header(46, view => {
				view.setUint32(0, 0x02014b50, true);
				view.setUint16(4, 20, true);
				view.setUint16(6, 20, true);
				view.setUint16(8, 0x0800, true);
				view.setUint16(12, time, true);
				view.setUint16(14, date, true);
				view.setUint32(16, crc, true);
				view.setUint32(20, size, true);
				view.setUint32(24, size, true);
				view.setUint16(28, name.length, true);
				view.setUint32(42, at, true);
			}),
		);
		yield counted(name);
	}

	yield header(22, view => {
		view.setUint32(0, 0x06054b50, true);
		view.setUint16(8, central.length, true);
		view.setUint16(10, central.length, true);
		view.setUint32(12, offset - start, true);
		view.setUint32(16, start, true);
	});
};

// Pulled as it's read, so a large folder never sits in memory whole
export const zipStream = entries => {
	const chunks = zipChunks(entries);

	return new ReadableStream({
		async pull(controller) {
			try {
				const { value, done } = await chunks.next();

				if (done) controller.close();
				else controller.enqueue(value);
			} catch (error) {
				controller.error(error);
			}
		},
		cancel: () => chunks.return(),
	});
};
