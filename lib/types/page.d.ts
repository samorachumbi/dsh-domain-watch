/**
 * The host-rendered board at /domain-watch/ui.
 *
 * Server-rendered HTML with no client bundle: the page works with JavaScript off, cannot go stale
 * against a build step, and adds nothing to the harness UI. Expiry countdowns are computed per
 * request from the remembered registry answers, so the numbers move even when nobody clicks
 * anything — which is the point, because the failure being guarded against is time passing.
 *
 * @module dsh-domain-watch/page
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DomainWatchService } from './service.ts';
export declare const ROUTE_PREFIX = "/domain-watch";
/** Same posture as the harness's own `/api` fence: cheap, and it closes the obvious hole. */
export declare function isLoopbackHost(req: IncomingMessage): boolean;
export declare function createHandlers(service: DomainWatchService): {
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
};
export type DomainWatchHandlers = ReturnType<typeof createHandlers>;
