/** Publication handles become subdomains: <handle>.<PLATFORM_DOMAIN>. */
import { createHandleChecker, HANDLE_RE, suggestHandle, type HandleCheck } from '@rubrion/core/handles';

export { HANDLE_RE, suggestHandle, type HandleCheck };

/** Shared reserved words (@rubrion/core) plus EdgeLetter's own brand. */
export const checkHandle = createHandleChecker(['edgeletter']);
