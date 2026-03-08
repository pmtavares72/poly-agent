export function formatUSDC(n: number, showSign = true): string {
  const abs = Math.abs(n).toFixed(2)
  if (!showSign) return `$${abs}`
  if (n >= 0) return `+$${abs}`
  return `-$${abs}`
}

export function formatPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`
}

export function formatHours(h: number): string {
  return `${h.toFixed(1)}h`
}

export function formatPrice(n: number): string {
  return `$${n.toFixed(4)}`
}

export function hoursUntilClose(closesAt: string): number {
  return Math.max(0, (new Date(closesAt).getTime() - Date.now()) / 3_600_000)
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
