// High-resolution timing for performance measurement
export function hrtimeMs(): number {
  const [sec, nsec] = process.hrtime();
  return sec * 1000 + nsec / 1_000_000;
}

export function measureMs(startMs: number): number {
  return Math.round((hrtimeMs() - startMs) * 1000) / 1000; // microsecond precision
}
