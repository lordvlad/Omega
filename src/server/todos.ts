/**
 * Todo list management and mutations.
 *
 * Implements interactive todo mutations (append, start, done, drop, block,
 * unblock, rm, clear, set) that update `live.session.setTodoPhases` in memory
 * and persist canonical snapshots as `"user_todo_edit"` entries on the session
 * branch so changes survive session reloads.
 */
import type { MutateTodosRequest, TodoPhase, TodoTask } from "../shared/model.ts";
import type { Ack } from "../shared/model.ts";
import type { LiveSession } from "./registry.ts";

/** Deep copy phases array to prevent accidental in-place mutations before committing. */
function clonePhases(phases: readonly TodoPhase[]): TodoPhase[] {
  return phases.map((phase) => ({
    name: phase.name,
    tasks: phase.tasks.map((task) => ({
      content: task.content,
      status: task.status,
      blocker: task.blocker,
    })),
  }));
}

/** Fuzzy/exact finder for a phase by name (case-insensitive). */
function findPhase(phases: TodoPhase[], name: string): TodoPhase | undefined {
  const norm = name.trim().toLowerCase();
  return phases.find((p) => p.name.trim().toLowerCase() === norm);
}

/** Fuzzy/exact finder for a task across all phases. */
function findTask(
  phases: TodoPhase[],
  query: string,
): { phase: TodoPhase; task: TodoTask; taskIndex: number } | undefined {
  const norm = query.trim().toLowerCase();
  // 1. Exact match
  for (const phase of phases) {
    for (let i = 0; i < phase.tasks.length; i++) {
      const task = phase.tasks[i]!;
      if (task.content.trim().toLowerCase() === norm) {
        return { phase, task, taskIndex: i };
      }
    }
  }
  // 2. Substring match
  for (const phase of phases) {
    for (let i = 0; i < phase.tasks.length; i++) {
      const task = phase.tasks[i]!;
      if (task.content.trim().toLowerCase().includes(norm)) {
        return { phase, task, taskIndex: i };
      }
    }
  }
  return undefined;
}

/**
 * Pure mutation function applying a `MutateTodosRequest` to a phases array.
 */
export function applyTodoMutation(currentPhases: readonly TodoPhase[], request: MutateTodosRequest): TodoPhase[] {
  const next = clonePhases(currentPhases);

  switch (request.action) {
    case "append": {
      const targetPhaseName = request.phase?.trim() || (next.length > 0 ? next[next.length - 1]!.name : "Tasks");
      let phase = findPhase(next, targetPhaseName);
      if (!phase) {
        phase = { name: targetPhaseName, tasks: [] };
        next.push(phase);
      }
      const itemsToAdd: string[] = request.items?.length
        ? request.items.map((s) => s.trim()).filter(Boolean)
        : request.task?.trim()
          ? [request.task.trim()]
          : [];

      for (const content of itemsToAdd) {
        // Prevent exact duplicate in the same phase
        if (!phase.tasks.some((t) => t.content === content)) {
          phase.tasks.push({
            content,
            status: request.status ?? "pending",
            blocker: request.blocker?.trim() || undefined,
          });
        }
      }
      break;
    }

    case "start": {
      if (request.task) {
        const hit = findTask(next, request.task);
        if (hit) {
          hit.task.status = "in_progress";
        }
      }
      break;
    }

    case "done": {
      if (request.task) {
        const hit = findTask(next, request.task);
        if (hit) {
          hit.task.status = "completed";
        }
      } else if (request.phase) {
        const phase = findPhase(next, request.phase);
        if (phase) {
          for (const task of phase.tasks) {
            task.status = "completed";
          }
        }
      } else {
        // Complete all
        for (const phase of next) {
          for (const task of phase.tasks) {
            task.status = "completed";
          }
        }
      }
      break;
    }

    case "drop": {
      if (request.task) {
        const hit = findTask(next, request.task);
        if (hit) {
          hit.task.status = "abandoned";
        }
      } else if (request.phase) {
        const phase = findPhase(next, request.phase);
        if (phase) {
          for (const task of phase.tasks) {
            task.status = "abandoned";
          }
        }
      } else {
        // Drop all
        for (const phase of next) {
          for (const task of phase.tasks) {
            task.status = "abandoned";
          }
        }
      }
      break;
    }

    case "block": {
      if (request.task) {
        const hit = findTask(next, request.task);
        if (hit) {
          hit.task.status = "blocked";
          hit.task.blocker = request.blocker?.trim() || "Blocked";
        }
      }
      break;
    }

    case "unblock": {
      if (request.task) {
        const hit = findTask(next, request.task);
        if (hit) {
          hit.task.status = "pending";
          hit.task.blocker = undefined;
        }
      }
      break;
    }

    case "rm": {
      if (request.task) {
        const hit = findTask(next, request.task);
        if (hit) {
          hit.phase.tasks.splice(hit.taskIndex, 1);
        }
      } else if (request.phase) {
        const phaseIndex = next.findIndex((p) => p.name.trim().toLowerCase() === request.phase?.trim().toLowerCase());
        if (phaseIndex !== -1) {
          next.splice(phaseIndex, 1);
        }
      }
      break;
    }

    case "clear": {
      if (request.status) {
        // Clear all tasks matching status (e.g. completed)
        for (const phase of next) {
          phase.tasks = phase.tasks.filter((t) => t.status !== request.status);
        }
      } else {
        next.length = 0;
      }
      break;
    }

    case "set": {
      if (request.phases) {
        return clonePhases(request.phases);
      }
      if (request.task && request.status) {
        const hit = findTask(next, request.task);
        if (hit) {
          hit.task.status = request.status;
          if (request.blocker !== undefined) {
            hit.task.blocker = request.blocker.trim() || undefined;
          }
        }
      }
      break;
    }
  }

  // Filter out completely empty phases if multiple phases exist and we're not down to 0
  return next.filter((phase, idx) => phase.tasks.length > 0 || (next.length === 1 && idx === 0));
}

/**
 * Apply a mutation to a live session's todos, persist it, and touch the session.
 */
export async function mutateSessionTodos(live: LiveSession, request: MutateTodosRequest): Promise<Ack> {
  const current = (live.session.getTodoPhases() as TodoPhase[]) ?? [];
  const updated = applyTodoMutation(current, request);

  live.session.setTodoPhases(updated as any);
  live.manager.appendCustomEntry("user_todo_edit", { phases: updated });
  live.touch();

  return { ok: true, detail: `Todos updated (${request.action}).` };
}
