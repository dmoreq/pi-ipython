/**
 * Abort signal helpers for cancelable operations.
 */

/**
 * Combine an existing AbortSignal with an optional timeout.
 * Returns a new AbortSignal that aborts if either the original signal
 * aborts or the timeout expires.
 */
export function combineAbortSignal(
	signal?: AbortSignal,
	timeoutMs?: number,
	fallbackReason = "Operation aborted",
): AbortSignal | undefined {
	if (signal?.aborted) {
		return signal;
	}

	const signals: AbortSignal[] = [];
	if (signal) signals.push(signal);

	if (timeoutMs !== undefined) {
		if (timeoutMs <= 0) {
			return AbortSignal.abort(new DOMException(fallbackReason, "TimeoutError"));
		}
		signals.push(AbortSignal.timeout(timeoutMs));
	}

	if (signals.length === 0) return undefined;
	if (signals.length === 1) return signals[0];
	return AbortSignal.any(signals);
}

/**
 * Throw if the given signal is already aborted.
 */
export function throwIfAborted(
	signal: AbortSignal | undefined,
	fallbackReason: string,
): void {
	if (!signal?.aborted) return;
	throw getAbortReason(signal, fallbackReason);
}

/**
 * Extract the abort reason from a signal, with a fallback message.
 */
export function getAbortReason(
	signal: AbortSignal | undefined,
	fallbackReason: string,
): Error {
	if (!signal?.aborted) {
		return new Error(fallbackReason);
	}
	const reason = signal.reason;
	if (reason instanceof Error) return reason;
	if (typeof reason === "string") return new Error(reason);
	return new Error(fallbackReason);
}
