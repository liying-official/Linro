import { fail } from './errors.js';

export interface BoundedBodyOptions {
  maxBytes: number;
  emptyCode: string;
  emptyMessage: string;
}

/** Read a request stream once while enforcing both declared and actual byte limits. */
export async function readBoundedBody(
  request: Request,
  options: BoundedBodyOptions,
): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > options.maxBytes) {
    fail(413, 'body_too_large', 'Request body is too large.');
  }
  if (!request.body) fail(400, options.emptyCode, options.emptyMessage);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > options.maxBytes) {
        await reader.cancel();
        fail(413, 'body_too_large', 'Request body is too large.');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
