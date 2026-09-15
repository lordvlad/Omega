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
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  showThinking: true,
  showToolCalls: true,
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
