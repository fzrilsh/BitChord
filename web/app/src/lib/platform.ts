import { config } from '@/config';

/**
 * Mobile browsers can't install the extension, so they get the Android app
 * banner instead of the install prompt (prompt §1).
 */
export function isMobileBrowser(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof uaData?.mobile === 'boolean') return uaData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * iOS (and iPadOS, which reports itself as a Mac with a touch screen).
 *
 * On iOS the player uses a plain `<audio>` element with a direct googlevideo
 * URL: googlevideo sends no CORS headers, so Shaka's fetch-based loader is
 * refused, while the media element itself is not (measured 2026-11-05).
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** Whether the pure-web Worker is configured, which is what makes the app usable without the extension. */
export function hasWorkerProxy(): boolean {
  return Boolean(config.workerUrl);
}

/** True when the app can reach YouTube Music without the extension. */
export function isPureWeb(): boolean {
  return hasWorkerProxy();
}
