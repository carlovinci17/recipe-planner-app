"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input for the Kitchen Assistant via the browser's Web Speech API
 * (`SpeechRecognition`, `webkitSpeechRecognition` on Safari/Chrome). Free, no
 * infrastructure, and the audio never touches our servers. Unsupported
 * browsers (Firefox) get `supported: false`, and the mic button hides.
 *
 * Azure AI Speech is the upgrade path if recognition quality or coverage
 * becomes a problem — see docs/TODO.md.
 */

// Minimal shape of the API — lib.dom does not type the webkit-prefixed one.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechInput({
  onTranscript,
}: {
  /** Called with the full transcript so far (interim while talking, then final). */
  onTranscript: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Feature-detect after mount: the server render has no `window`.
  useEffect(() => setSupported(getCtor() !== null), []);
  useEffect(() => () => recRef.current?.abort(), []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-AU";
    rec.continuous = false; // one utterance, then stop — a question, not dictation
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i]![0].transcript;
      onTranscriptRef.current(text.trim());
    };
    rec.onerror = (e) => {
      // "no-speech" and "aborted" are normal ends, not failures worth showing.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access is blocked — allow it in your browser settings.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setError("Couldn't hear that — try again.");
      }
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    setError(null);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, []);

  const stop = useCallback(() => recRef.current?.stop(), []);

  return { supported, listening, error, start, stop };
}
