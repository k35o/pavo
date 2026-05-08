// Tiny env-var helper shared by the prompt builders.

import process from 'node:process';

/**
 * Return the named env var or throw if it is undefined.
 * Empty string is treated as a valid (set) value because some
 * inputs (PR_BODY, EXTRA_PROMPT) can legitimately be empty.
 *
 * @param {string} key
 * @returns {string}
 */
export function requireEnv(key) {
  const value = process.env[key];
  if (value === undefined) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}
