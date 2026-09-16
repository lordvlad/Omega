import * as os from "node:os";

/**
 * The omega server: static client, REST routes, and one AG-UI WebSocket per
 * live session.
 *
 * It binds on every interface because the point is to reach it from a phone on
 * the same network. There is no authentication: this process can run arbitrary
 * tools in your working directories, so it belongs on a trusted LAN only.
 * `OMEGA_HOST=127.0.0.1` restricts it to this machine.
 */
import { serve, type ServerWebSocket } from "bun";

import index from "../client/index.html";
import type { AguiFrame } from "./agui.ts";
import { registry } from "./registry.ts";
import { handlers, HttpError } from "./router.ts";

const PORT = Number(process.env.OMEGA_PORT ?? 4319);
const HOST = process.env.OMEGA_HOST ?? "0.0.0.0";

/** Per-socket state: which session it streams and how to detach. */
interface SocketData {
  key: string;
  detach?: () => void;
  detachClose?: () => void;
}

/** Run a handler, mapping thrown `HttpError`s onto the documented `Problem`. */
async function json(run: () => Promise<unknown>, okStatus = 200): Promise<Response> {
  try {
    return Response.json(await run(), { status: okStatus });
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ status: error.status, detail: error.message }, { status: error.status });
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[omega] handler failed:", detail);
    return Response.json({ status: 500, detail }, { status: 500 });
  }
}

/**
 * Route entries serving files from `public/`.
 *
 * The icons and the manifest are content-stable and small, so they get a long
 * immutable max-age; renaming one is how you change it.
 */
function staticFiles(entries: Record<string, [file: string, type: string]>): Record<string, () => Response> {
  const routes: Record<string, () => Response> = {};
  for (const [path, [file, type]] of Object.entries(entries)) {
    const url = new URL(`../../public/${file}`, import.meta.url);
    routes[path] = () =>
      new Response(Bun.file(url), {
        headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" },
      });
  }
  return routes;
}

const server = serve({
  port: PORT,
  hostname: HOST,
  // A planning turn can think for minutes before writing the plan file; the
  // default idle timeout would drop the socket mid-turn.
  idleTimeout: 255,

  routes: {
    "/api/workspaces": { GET: () => json(() => handlers.listWorkspaces()) },
    "/api/models": { GET: () => json(() => handlers.listModels()) },
    "/api/files": {
      GET: request => {
        const url = new URL(request.url);
        const cwd = url.searchParams.get("cwd") || undefined;
        return json(() => handlers.listFiles({ cwd }));
      },
    },
    "/api/files/content": {
      GET: request => {
        const url = new URL(request.url);
        const path = url.searchParams.get("path") || "";
        const cwd = url.searchParams.get("cwd") || undefined;
        return json(() => handlers.getFileContent({ path, cwd }));
      },
    },
    "/api/git/status": {
      GET: request => {
        const url = new URL(request.url);
        const cwd = url.searchParams.get("cwd") || undefined;
        return json(() => handlers.getGitStatus({ cwd }));
      },
    },

    "/api/sessions": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.openSession(body));
      },
    },

    "/api/sessions/:key/state": {
      GET: request => json(() => handlers.getState(request.params.key)),
    },
    "/api/sessions/:key/transcript": {
      GET: request => {
        const url = new URL(request.url);
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw === null ? undefined : Number(limitRaw);
        return json(() =>
          handlers.getTranscript(request.params.key, {
            limit: Number.isFinite(limit) ? limit : undefined,
            // Absent means "send everything"; only an explicit `false` hides.
            thinking: url.searchParams.get("thinking") !== "false",
            toolCalls: url.searchParams.get("toolCalls") !== "false",
          }),
        );
      },
    },
    "/api/sessions/:key/prompt": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.prompt(request.params.key, body), 202);
      },
    },
    "/api/sessions/:key/queue": {
      GET: request => json(() => handlers.listQueue(request.params.key)),
    },
    "/api/sessions/:key/commands": {
      GET: request => json(() => handlers.listCommands(request.params.key)),
    },
    "/api/sessions/:key/queue/edit": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.editQueued(request.params.key, body));
      },
    },
    "/api/sessions/:key/queue/drop": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.dropQueued(request.params.key, body));
      },
    },
    "/api/sessions/:key/abort": {
      POST: request => json(() => handlers.abort(request.params.key)),
    },
    "/api/sessions/:key/btw": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.askBtw(request.params.key, body));
      },
    },
    "/api/sessions/:key/omfg": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.analyzeOmfg(request.params.key, body));
      },
    },
    "/api/sessions/:key/omfg/save": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.saveOmfgRule(request.params.key, body));
      },
    },
    "/api/sessions/:key/stop": {
      POST: request => json(() => handlers.stopSession(request.params.key)),
    },
    "/api/sessions/:key": {
      DELETE: request => json(() => handlers.deleteSession(request.params.key)),
    },
    "/api/sessions/:key/model": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.selectModel(request.params.key, body));
      },
    },
    "/api/sessions/:key/compact": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.compactSession(request.params.key, body));
      },
    },
    "/api/sessions/:key/shake": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.shakeSession(request.params.key, body));
      },
    },
    "/api/sessions/:key/thinking": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.setThinkingLevel(request.params.key, body));
      },
    },
    "/api/sessions/:key/title": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.renameSession(request.params.key, body));
      },
    },
    "/api/sessions/:key/retry": {
      POST: request => json(() => handlers.retryTurn(request.params.key)),
    },
    "/api/sessions/:key/fork": {
      POST: request => json(() => handlers.forkSession(request.params.key)),
    },
    "/api/sessions/:key/branch-points": {
      GET: request => json(() => handlers.listBranchPoints(request.params.key)),
    },
    "/api/sessions/:key/branch": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.branchSession(request.params.key, body));
      },
    },

    "/api/sessions/:key/plan": {
      GET: request => json(() => handlers.getPlan(request.params.key)),
    },
    "/api/sessions/:key/plan/mode": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.setPlanMode(request.params.key, body));
      },
    },
    "/api/sessions/:key/plan/document": {
      PUT: async request => {
        const body = await request.json();
        return json(() => handlers.editPlan(request.params.key, body));
      },
    },
    "/api/sessions/:key/plan/action": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.resolvePlan(request.params.key, body));
      },
    },

    "/api/markdown": {
      POST: async request => {
        const body = await request.json();
        return json(() => handlers.renderMarkdown(body));
      },
    },

    /** AG-UI stream for one session. */
    "/ws/:key": request => {
      const key = request.params.key;
      if (!registry.get(key)) return new Response("No such session", { status: 404 });
      if (server.upgrade(request, { data: { key } })) return undefined as unknown as Response;
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    },

    /**
     * PWA assets, served from disk ahead of the catch-all.
     *
     * Each needs an explicit route: `/*` answers the SPA's HTML, so without
     * these the browser would fetch `/sw.js` and be handed a document.
     */
    ...staticFiles({
      "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
      "/icon-192.png": ["icon-192.png", "image/png"],
      "/icon-512.png": ["icon-512.png", "image/png"],
      "/icon-maskable-512.png": ["icon-maskable-512.png", "image/png"],
      "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"],
    }),

    /**
     * The worker itself, which must never be served stale: a cached copy is
     * a cache the user cannot invalidate. `Service-Worker-Allowed` lets it
     * claim the whole origin regardless of where the file sits.
     */
    "/sw.js": () =>
      new Response(Bun.file(new URL("../../public/sw.js", import.meta.url)), {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
          "service-worker-allowed": "/",
        },
      }),

    // Everything else is the single-page client.
    "/*": index,
  },

  websocket: {
    open(socket: ServerWebSocket<SocketData>) {
      const live = registry.get(socket.data.key);
      if (!live) {
        socket.close(1011, "session closed");
        return;
      }
      // `subscribe` replays the frames this session already produced, so a
      // browser that connects mid-turn — or reconnects after the phone
      // slept — still renders the whole turn.
      socket.data.detach = live.subscribe((frame: AguiFrame) => {
        socket.send(JSON.stringify(frame));
      });
      // An idle sweep can dispose this session while the tab is still open;
      // close the socket deliberately so the client stops rather than
      // streaming from a disposed agent.
      socket.data.detachClose = live.onClosed(() => socket.close(1001, "session idle"));
    },
    message(socket: ServerWebSocket<SocketData>, raw) {
      // The only client→server frame is a keepalive; prompts and aborts are
      // REST calls so they get a status code and an error body.
      if (raw === "ping") socket.send(JSON.stringify({ type: "CUSTOM", name: "omp.pong", value: null }));
    },
    close(socket: ServerWebSocket<SocketData>) {
      // Detach only. A disconnect is never forwarded to omp: the agent keeps
      // running so a locked phone or closed laptop does not abort a turn, and
      // the idle sweep is what eventually reclaims an abandoned session.
      socket.data.detach?.();
      socket.data.detachClose?.();
    },
  },

  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      // Sessions own child processes, MCP connections and eval kernels;
      // dropping the process without disposing them leaks all three.
      await registry.disposeAll();
      process.exit(0);
    })();
  });
}

registry.startSweeping((key, idleMinutes) => {
  console.log(`[omega] released session ${key} after ${idleMinutes}m idle`);
});

console.log(`omega listening on:`);
console.log(`  Local:   http://localhost:${PORT}`);
if (HOST === "0.0.0.0" || HOST === "::" || HOST === "") {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        const label = name.startsWith("tailscale")
          ? "Tailscale"
          : name.startsWith("docker") || name.startsWith("br-")
            ? "Docker"
            : "Network";
        console.log(`  ${label.padEnd(9)}: http://${addr.address}:${PORT} (${name})`);
      }
    }
  }
} else if (HOST !== "127.0.0.1" && HOST !== "localhost") {
  console.log(`  Network:   http://${HOST}:${PORT}`);
}
console.log(
  registry.idleMinutes > 0
    ? `  Sessions survive disconnects; released after ${registry.idleMinutes}m idle (OMEGA_IDLE_MINUTES)`
    : "  Sessions survive disconnects and are never released (OMEGA_IDLE_MINUTES=0)",
);
