// TYMCZASOWA diagnostyka wydajności ładowania treści z OneDrive (do
// usunięcia po znalezieniu wąskiego gardła 10-16s przy zimnym otwarciu
// rozdziału). Marcin nie ma dostępu do DevTools/konsoli przeglądarki, więc
// zamiast console.time używamy widocznego na ekranie podsumowania.
export function driveTimingReset(): void {
  (window as any).__driveTiming = [{ label: "start", t: performance.now() }];
}

export function driveMark(label: string): void {
  const log = (window as any).__driveTiming;
  if (!log) return;
  log.push({ label, t: performance.now() });
}

export function driveTimingSummary(): string {
  const log = (window as any).__driveTiming;
  if (!log || log.length < 2) return "";
  const parts: string[] = [];
  for (let i = 1; i < log.length; i++) {
    parts.push(`${log[i].label}:${Math.round(log[i].t - log[i - 1].t)}ms`);
  }
  parts.push(`total:${Math.round(log[log.length - 1].t - log[0].t)}ms`);
  return parts.join(" ");
}
