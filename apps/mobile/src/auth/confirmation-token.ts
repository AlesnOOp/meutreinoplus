/** Accept both the code and the complete link copied from an account email. */
export function confirmationToken(value: string): string {
  const input = value.trim();
  const match = /[?&]token=([^&#\s]+)/.exec(input);
  return match?.[1] ? decodeURIComponent(match[1]) : input;
}
