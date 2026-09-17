/**
 * Async background jobs and supervised long-running process management.
 */
import { daemonClientForProject } from "@oh-my-pi/pi-coding-agent/launch/client";

import type {
  Ack,
  CancelJobRequest,
  ListJobsResult,
  ListProcessesResult,
  ManagedProcessInfo,
  ProcessActionRequest,
  ProcessLifecycleState,
  SessionAsyncJob,
  SignalProcessRequest,
} from "../shared/model.ts";
import type { LiveSession } from "./registry.ts";

/**
 * List running and recent async background jobs for this session.
 */
export function listSessionJobs(live: LiveSession): ListJobsResult {
  const snapshot = live.session.getAsyncJobSnapshot({ recentLimit: 20 });
  if (!snapshot) return { running: [], recent: [] };

  const mapJob = (job: any): SessionAsyncJob => ({
    id: job.id,
    type: job.type || "task",
    label: job.label || undefined,
    status: job.status || "running",
    startTime: job.startTime || Date.now(),
    durationMs: job.startTime ? Date.now() - job.startTime : undefined,
    error: job.error || undefined,
  });

  return {
    running: (snapshot.running ?? []).map(mapJob),
    recent: (snapshot.recent ?? []).map(mapJob),
  };
}

/**
 * Cancel a running async background job.
 */
export function cancelSessionJob(live: LiveSession, request: CancelJobRequest): Ack {
  const id = request.id.trim();
  if (!id) throw new Error("Job id is required.");

  try {
    const manager = live.session.asyncJobManager;
    if (manager) {
      manager.cancel(id);
    }
    return { ok: true, detail: `Cancelled job "${id}".` };
  } catch (error) {
    throw new Error(
      `Failed to cancel job "${id}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function mapDaemonState(state: string | undefined): ProcessLifecycleState {
  switch (state) {
    case "running":
    case "ready":
      return "running";
    case "starting":
      return "starting";
    case "idle":
      return "idle";
    case "exited":
    case "stopped":
    default:
      return "exited";
  }
}

/**
 * List supervised processes in the workspace via the daemon broker.
 */
export async function listManagedProcesses(cwd?: string): Promise<ListProcessesResult> {
  const targetCwd = cwd || process.cwd();
  try {
    const client = await daemonClientForProject(targetCwd);
    const result = await client.request({ op: "list" });
    const daemons = result.op === "list" ? (result.daemons ?? []) : [];

    const processes: ManagedProcessInfo[] = daemons.map((d: any) => ({
      name: d.name,
      state: mapDaemonState(d.state),
      pid: d.pid || undefined,
      application: d.application || undefined,
      args: d.args || undefined,
      startedAt: d.startedAt || undefined,
      readyAt: d.readyAt || undefined,
      exitedAt: d.exitedAt || undefined,
      exitCode: d.exitCode !== undefined ? d.exitCode : undefined,
      restartCount: d.restartCount || 0,
      outputBytes: d.outputBytes || 0,
      owner: d.owner || undefined,
    }));

    return { processes };
  } catch {
    return { processes: [] };
  }
}

/**
 * Send a signal (SIGINT, SIGTERM, SIGKILL) to a supervised process.
 */
export async function signalManagedProcess(request: SignalProcessRequest): Promise<Ack> {
  const name = request.name.trim();
  if (!name) throw new Error("Process name is required.");

  const client = await daemonClientForProject(request.cwd || process.cwd());
  await client.request({ op: "send", name, signal: request.signal });
  return { ok: true, detail: `Sent ${request.signal} to process "${name}".` };
}

/**
 * Stop a supervised process.
 */
export async function stopManagedProcess(request: ProcessActionRequest): Promise<Ack> {
  const name = request.name.trim();
  if (!name) throw new Error("Process name is required.");

  const client = await daemonClientForProject(request.cwd || process.cwd());
  await client.request({ op: "stop", name, timeoutMs: 5000 });
  return { ok: true, detail: `Stopped process "${name}".` };
}

/**
 * Restart a supervised process.
 */
export async function restartManagedProcess(request: ProcessActionRequest): Promise<Ack> {
  const name = request.name.trim();
  if (!name) throw new Error("Process name is required.");

  const client = await daemonClientForProject(request.cwd || process.cwd());
  await client.request({ op: "restart", name });
  return { ok: true, detail: `Restarted process "${name}".` };
}
