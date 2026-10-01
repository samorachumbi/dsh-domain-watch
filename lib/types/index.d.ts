/**
 * dsh-domain-watch host half (cordis plugin body).
 *
 * Owns the watched-domain store, the registry queries behind the agent tools, and one
 * host-rendered page at `<origin>/domain-watch/ui`. Everything is host-plane.
 *
 * There is no client half on purpose. The board lives in its own browser tab, which keeps the
 * harness UI uncrowded and — because no `dsh.client` manifest exists — keeps `dsh-client-modules`
 * from trying to compose a bundle that would then have to be built and shipped.
 *
 * Export shape: function/namespace plugin (name/inject/Config/apply, NO default — a stray
 * `export default` would collapse the module through the Loader's unwrapExports and drop
 * `inject`, which upstream shipped once and which aborts the boot).
 *
 * @module dsh-domain-watch
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
import type { PluginConfig } from './config.ts';
export { Config };
export declare const name = "dsh-domain-watch";
/** storageDomain: the watch list. webServer: the registry API and the board. `tools` is optional. */
export declare const inject: string[];
export declare function apply(ctx: Context, config: PluginConfig): void;
