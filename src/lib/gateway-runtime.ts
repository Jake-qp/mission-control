import { logger } from '@/lib/logger'

/**
 * Register MC as the default dashboard for a gateway.
 * Legacy OpenClaw config-file registration has been removed.
 * This now always returns not-registered — gateway registration
 * should be done via the gateway API or env vars.
 */
export function registerMcAsDashboard(_mcUrl: string): { registered: boolean; alreadySet: boolean } {
  return { registered: false, alreadySet: false }
}

/**
 * Returns the gateway auth credential (token or password) for Bearer/WS auth.
 * Env overrides: GATEWAY_TOKEN, GATEWAY_PASSWORD.
 */
export function getDetectedGatewayToken(): string {
  const envToken = (process.env.GATEWAY_TOKEN || '').trim()
  if (envToken) return envToken

  const envPassword = (process.env.GATEWAY_PASSWORD || '').trim()
  if (envPassword) return envPassword

  return ''
}

export function getDetectedGatewayPort(): number | null {
  const envPort = Number(process.env.GATEWAY_PORT || '')
  if (Number.isFinite(envPort) && envPort > 0) return envPort
  return null
}
