export function redactToken(token: string): string {
  if (!token || token.length < 10) return '[REDACTED]'
  return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`
}
