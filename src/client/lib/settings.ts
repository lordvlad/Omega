/**
 * Per-project display settings, persisted in localStorage.
 *
 * Scoped by workspace cwd rather than session: what a transcript shows is a
 * preference about a workspace, not something that should reset every time a
 * new session opens in it.
 */
import { useLocalStorage } from "@mantine/hooks";

export interface ProjectSettings {
  /** Show the agent's thinking blocks in the transcript. */
  showThinking: boolean;
  /** Show tool calls and their results in the transcript. */
  showToolCalls: boolean;
  /** Show native browser notifications when the agent yields/finishes a turn. */
  notifyOnYield: boolean;
  /** Submit message on Enter (Shift+Enter inserts newline, Ctrl/Cmd+Enter always submits). */
  enterSubmits: boolean;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  showThinking: true,
  showToolCalls: true,
  notifyOnYield: true,
  enterSubmits: false,
};

function isProjectSettings(value: unknown): value is Partial<ProjectSettings> {
  return typeof value === "object" && value !== null;
}

export function useProjectSettings(
  projectKey: string | undefined,
): [ProjectSettings, (key: keyof ProjectSettings) => void] {
  const [settings, setSettings] = useLocalStorage<ProjectSettings>({
    key: `omega:settings:${projectKey || "root"}`,
    defaultValue: DEFAULT_PROJECT_SETTINGS,
    // Read on the first render, not in an effect: the transcript request
    // carries these settings, so a deferred read fetches the unfiltered
    // window first and then immediately refetches the filtered one.
    getInitialValueInEffect: false,
    // Spread over the defaults rather than trusting storage outright: a
    // setting added after this was written must not read as `undefined`
    // (falsy) forever for everyone who saved before it existed.
    deserialize: raw => {
      if (raw === undefined) return DEFAULT_PROJECT_SETTINGS;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isProjectSettings(parsed)
          ? { ...DEFAULT_PROJECT_SETTINGS, ...parsed }
          : DEFAULT_PROJECT_SETTINGS;
      } catch {
        return DEFAULT_PROJECT_SETTINGS;
      }
    },
  });

  const toggle = (key: keyof ProjectSettings): void => {
    setSettings(current => ({ ...current, [key]: !current[key] }));
  };

  return [settings, toggle];
}
