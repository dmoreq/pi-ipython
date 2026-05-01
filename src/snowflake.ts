/**
 * Snowflake-style unique ID generator.
 *
 * Produces unique, sortable string IDs. Uses a combination of timestamp,
 * counter, and random bits.
 */

let _counter = 0;
let _lastTimestamp = 0;

/** Generate a unique snowflake ID string. */
export function snowflake(): string {
	const now = Date.now();
	if (now === _lastTimestamp) {
		_counter++;
	} else {
		_counter = 0;
		_lastTimestamp = now;
	}
	const random = (Math.random() * 0xffff) | 0;
	return `${now.toString(36)}${_counter.toString(36).padStart(2, "0")}${random.toString(36).padStart(3, "0")}`;
}

export const Snowflake = {
	next: snowflake,
};
