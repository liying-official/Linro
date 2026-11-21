/** Cancel superseded reads, including results queued for a later React commit. */
export class LatestRead {
  private active?: AbortController;
  cancel() {
    this.active?.abort();
  }
  async run<T>(
    read: (signal: AbortSignal) => Promise<T>,
    ready: (value: T, signal: AbortSignal) => void,
    failed: (error: unknown, signal: AbortSignal) => void,
  ) {
    this.cancel();
    this.active = new AbortController();
    const signal = this.active.signal;
    let result: T;
    try {
      result = await read(signal);
    } catch (error) {
      if (!signal.aborted) failed(error, signal);
      return;
    }
    if (!signal.aborted) ready(result, signal);
  }
}
