import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { config } from '@/config';
import { useTrackLog } from '@/playback/trackLog';
import { usePlayer } from '@/state/player';

/**
 * A phone-friendly report of what the player is actually doing.
 *
 * On iOS there is no console to open, and the player's own error text can be
 * lost behind a layout that never got a duration. This page prints the media
 * element's real state (duration, readyState, networkState, error code), the
 * last requests that mattered, and every console error, in a block that can be
 * copied with one tap.
 */

const ERROR_CODES: Record<number, string> = {
  1: 'ABORTED (the user or a script stopped it)',
  2: 'NETWORK (the fetch failed — often CORS or a refused URL)',
  3: 'DECODE (the bytes arrived but the codec could not be decoded)',
  4: 'SRC_NOT_SUPPORTED (the browser cannot use this URL or type)',
};

const NETWORK_STATES: Record<number, string> = {
  0: 'EMPTY (nothing loaded)',
  1: 'IDLE',
  2: 'LOADING',
  3: 'NO_SOURCE (no usable source)',
};

interface Snapshot {
  src: string;
  duration: number;
  currentTime: number;
  readyState: number;
  networkState: string;
  paused: boolean;
  crossOrigin: string | null;
  inDocument: boolean;
  error: string | null;
  canPlayAac: string;
  canPlayOpus: string;
  workerUrl: string;
  isStandalone: boolean;
  playerStatus: string;
  playerError: string | null;
}

function mediaElement(): HTMLAudioElement | null {
  return document.querySelector('audio');
}

export default function DiagnosePage() {
  const [lines, setLines] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const captured = useRef<string[]>([]);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const trackLines = useTrackLog((s) => s.lines);

  // Everything the page logs or throws, kept in order.
  useEffect(() => {
    const push = (line: string) => {
      captured.current.push(line);
      setLines([...captured.current]);
    };
    const onError = (event: ErrorEvent) => push(`[error] ${event.message}`);
    const onRejection = (event: PromiseRejectionEvent) => push(`[rejection] ${String(event.reason)}`);
    const original = console.error;
    console.error = (...args: unknown[]) => {
      push(`[console.error] ${args.map(String).join(' ')}`);
      original(...args);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      console.error = original;
    };
  }, []);

  // The element's own state, twice a second while the page is open.
  useEffect(() => {
    const tick = () => {
      const audio = mediaElement();
      setSnapshot({
        src: audio ? audio.currentSrc || audio.src || '(none)' : '(no audio element)',
        duration: audio?.duration ?? 0,
        currentTime: audio?.currentTime ?? 0,
        readyState: audio?.readyState ?? -1,
        networkState: audio ? (NETWORK_STATES[audio.networkState] ?? String(audio.networkState)) : '-',
        paused: audio?.paused ?? true,
        crossOrigin: audio?.getAttribute('crossorigin') ?? null,
        inDocument: audio ? document.body.contains(audio) : false,
        error: audio?.error ? `${audio.error.code} · ${ERROR_CODES[audio.error.code] ?? ''} ${audio.error.message}` : null,
        canPlayAac: audio ? audio.canPlayType('audio/mp4; codecs="mp4a.40.2"') || 'no' : '-',
        canPlayOpus: audio ? audio.canPlayType('audio/webm; codecs="opus"') || 'no' : '-',
        workerUrl: config.workerUrl || '(not set)',
        isStandalone: window.matchMedia('(display-mode: standalone)').matches,
        playerStatus: status,
        playerError: error,
      });
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [status, error]);

  const report = [
    `UA: ${navigator.userAgent}`,
    `display-mode standalone: ${snapshot?.isStandalone}`,
    `worker: ${snapshot?.workerUrl}`,
    '',
    `src: ${snapshot?.src}`,
    `duration: ${snapshot?.duration}`,
    `currentTime: ${snapshot?.currentTime}`,
    `readyState: ${snapshot?.readyState} (4 = enough data)`,
    `networkState: ${snapshot?.networkState}`,
    `paused: ${snapshot?.paused}`,
    `crossOrigin attr: ${snapshot?.crossOrigin ?? '(none)'}`,
    `in document: ${snapshot?.inDocument}`,
    `media error: ${snapshot?.error ?? '(none)'}`,
    `canPlayType mp4a: ${snapshot?.canPlayAac}`,
    `canPlayType opus: ${snapshot?.canPlayOpus}`,
    `player status: ${snapshot?.playerStatus}`,
    `player error: ${snapshot?.playerError ?? '(none)'}`,
    '',
    '--- player log ---',
    ...trackLines.slice(-60).map((line) => `${(line.t / 1000).toFixed(2)} ${line.level} ${line.about ?? ''} ${line.message}`),
    '',
    '--- page log ---',
    ...captured.current,
  ].join('\n');

  return (
    <>
      <PageHeader title="Diagnose" />
      <div className="mx-(--body-gutter) mt-5 max-w-[980px] pb-32">
        <button
          className="rounded-pill bg-key px-4 py-2 type-body-emphasized text-white"
          onClick={() => {
            void navigator.clipboard.writeText(report).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? 'Copied — send this' : 'Copy report'}
        </button>

        <h2 className="mt-6 mb-2 type-subhead-emphasized uppercase text-secondary">Media element</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[10px] bg-quinary px-4 py-3 type-callout">
          {[
            ['duration', String(snapshot?.duration)],
            ['currentTime', String(snapshot?.currentTime)],
            ['readyState', String(snapshot?.readyState)],
            ['networkState', String(snapshot?.networkState)],
            ['paused', String(snapshot?.paused)],
            ['crossOrigin', snapshot?.crossOrigin ?? '(none)'],
            ['in document', String(snapshot?.inDocument)],
            ['media error', snapshot?.error ?? '(none)'],
            ['canPlay mp4a', String(snapshot?.canPlayAac)],
            ['canPlay opus', String(snapshot?.canPlayOpus)],
            ['player status', String(snapshot?.playerStatus)],
            ['player error', snapshot?.playerError ?? '(none)'],
            ['worker', String(snapshot?.workerUrl)],
            ['standalone', String(snapshot?.isStandalone)],
          ].map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-secondary">{label}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-6 mb-2 type-subhead-emphasized uppercase text-secondary">src</h2>
        <pre className="overflow-x-auto rounded-[10px] bg-quinary p-3 type-callout [word-break:break-all]">{snapshot?.src}</pre>

        <h2 className="mt-6 mb-2 type-subhead-emphasized uppercase text-secondary">Log</h2>
        <ol className="max-h-[420px] overflow-auto rounded-[10px] bg-quinary px-3 py-2.5 [font:400_12px/18px_ui-monospace,Menlo,Consolas,monospace]">
          {lines.length === 0 && <li className="text-secondary">(nothing logged yet — start a track, then come back)</li>}
          {lines.map((line, index) => (
            <li key={index} className="break-all">
              {line}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
