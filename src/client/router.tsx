/**
 * The route tree.
 *
 * A workspace and a session are addresses, not UI state, so they live in the
 * path: `/w/$project/s/$session`. `$project` is the workspace's absolute cwd —
 * the router runs every path param through `encodeURIComponent` when it builds
 * a link and `decodeURIComponent` when it matches one, so the slashes in
 * `/data/workspace2/omega` survive as a single `%2F…` segment without any
 * custom codec here.
 *
 * The routes carry parameters and nothing else: `App` is the whole surface and
 * reads whichever params matched, so there is no nested view to swap and the
 * child routes render nothing.
 *
 * `@tanstack/react-router` is pinned to an exact version on purpose. From
 * 1.170 its `router-core` imports `load-client.js`, which imports
 * `router.js` back, and that cycle leaves the module namespace null when
 * `router.js` runs its development-only `_replaceRouteChunk` assignment at
 * import time. Under Bun's dev bundler that throws before the app mounts
 * ("Cannot read properties of null"); a production bundle drops the branch and
 * hides it. Re-test the dev server before widening this range.
 */
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { App } from "./App.tsx";

const rootRoute = createRootRoute({ component: App });
/**
 * The parameter-only routes.
 *
 * Each renders nothing: `App` is mounted once by the root route and reads
 * whichever params matched, so these exist purely to give the workspace and
 * session an address. They still declare a component because the router
 * prepares a render chunk for every matched route.
 */
const nothing = (): null => null;

/** No workspace chosen: the session tree with nothing open. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: nothing,
});

/** A workspace, expanded in the tree, with no session open. */
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$project",
  component: nothing,
});

/** A session inside a workspace — the linkable conversation. */
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$project/s/$session",
  component: nothing,
});

/**
 * A conversation with no workspace expanded.
 *
 * The two params are independent — `project` is the branch open in the tree,
 * `session` is the conversation on screen — so collapsing the tree must not
 * close the conversation.
 */
const sessionOnlyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/s/$session",
  component: nothing,
});

const routeTree = rootRoute.addChildren([indexRoute, projectRoute, sessionRoute, sessionOnlyRoute]);

export const router = createRouter({
  routeTree,
  // A stale conversation link should still resolve against the live server
  // rather than being served from a cached match.
  defaultStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
