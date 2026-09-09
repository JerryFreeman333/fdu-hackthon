/**
 * Legacy compatibility entrypoint.
 *
 * The original P0 runner used localStorage injection to simulate consent, which is
 * incompatible with the current session-only authorization model. Keep the filename
 * for existing commands, but delegate to the final black-box suite instead.
 */
await import('./run-final-blackbox.mjs');
