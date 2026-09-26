// Generate an unguessable endpoint id for an exposed MCP prompt.
// When the server runs without authentication this id is the only thing protecting the prompt,
// so it comes from the platform's cryptographic random generator (128 bits, 32 hex characters).
// The parameters are kept for compatibility with existing callers; they no longer affect the result.
export const generateSecureHash = (_promptId: number, _promptTitle: string): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
