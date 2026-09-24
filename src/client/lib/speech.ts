/**
 * Speech input via the browser's Web Speech API.
 *
 * `SpeechRecognition` is still vendor-prefixed on the browsers that implement
 * it, and absent entirely on Firefox, so support is reported rather than
 * assumed — the composer hides the microphone when it is unavailable instead
 * of offering a button that cannot work.
 *
 * Interim results are surfaced separately from final ones so the composer can
 * show words as they are recognised while only committing settled text.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** The slice of the Web Speech API this module uses. */
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionResultLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type RecognitionConstructor = new () => RecognitionLike;

/** Resolve the constructor, whichever prefix this browser uses. */
function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export interface Dictation {
  /** True when this browser can do speech recognition at all. */
  supported: boolean;
  listening: boolean;
  /** Words recognised but not yet settled, for a live preview. */
  interim: string;
  /** Why recognition stopped, when it stopped badly. */
  error?: string;
  start: () => void;
  stop: () => void;
}

/**
 * Dictate into a text field.
 *
 * `onCommit` receives each settled phrase; the caller appends it to whatever
 * the user has already typed, so dictation and typing compose.
 */
export function useDictation(onCommit: (text: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const recognition = useRef<RecognitionLike | undefined>(undefined);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  const supported = recognitionConstructor() !== undefined;

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setError("This browser has no speech recognition.");
      return;
    }
    // A fresh instance per session: a stopped recognizer cannot be restarted
    // reliably across implementations.
    const instance = new Constructor();
    recognition.current = instance;
    instance.lang = navigator.language || "en-US";
    // Continuous, so a pause for breath does not end dictation mid-thought.
    instance.continuous = true;
    instance.interimResults = true;

    instance.onresult = (event) => {
      let pending = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (!result) {
          continue;
        }
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          commit.current(text.trim());
        } else {
          pending += text;
        }
      }
      setInterim(pending.trim());
    };
    instance.onerror = (event) => {
      setError(
        event.error === "not-allowed"
          ? "Microphone permission denied."
          : `Speech recognition failed: ${event.error ?? "unknown"}`,
      );
      setListening(false);
      setInterim("");
    };
    instance.onend = () => {
      setListening(false);
      setInterim("");
    };

    setError(undefined);
    setInterim("");
    try {
      instance.start();
      setListening(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the microphone.");
    }
  }, []);

  useEffect(
    () => () => {
      // Leaving the page mid-dictation must release the microphone.
      recognition.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, error, start, stop };
}
