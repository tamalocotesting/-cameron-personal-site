/**
 * A no-op stand-in for the `server-only` package.
 *
 * `server-only` deliberately throws when it is loaded outside Next.js's
 * server bundle, which is exactly the guard we want in the application. But
 * the seed, the CLI scripts, the worker and the test suite all import the same
 * server modules from plain Node, where that guard fires incorrectly.
 *
 * tsconfig.scripts.json maps the import to this file for those entry points
 * only. The application's own tsconfig still resolves the real package, so the
 * guard keeps working where it matters.
 */
export {};
