/**
 * The agent tools. Four, all thin: every decision lives in `service.ts`.
 *
 * `domain_check` is the one that matters. Its `claimed` parameter is what makes it more than a
 * lookup — it is the vendor's assertion, and the answer names the disagreement with the registry
 * instead of averaging the two into a comfortable middle.
 *
 * @module dsh-domain-watch/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DomainWatchService } from './service.ts';
export interface ToolDeps {
    service: DomainWatchService;
}
export declare function buildTools({ service }: ToolDeps): import("@deepseek-ai/dsh-tools").ToolDefinition[];
/** Optional-dependency style: a profile with no tool registry gets no tools, not a failed boot. */
export declare function registerTools(ctx: Context, deps: ToolDeps): void;
