import { randomBytes } from 'node:crypto';

// Process-local inputs for isolated tests. Production Workers never import this module.
export const newTestSecret = () => randomBytes(32).toString('base64url');
export const testPassword = newTestSecret();
