/**
 * Stub — OpenClaw gateway integration has been removed.
 * This module is kept as a no-op shim so existing callers compile.
 * Gateway calls now go through the generic gateway HTTP client.
 */

import { logger } from '@/lib/logger'

/**
 * @deprecated OpenClaw gateway has been removed. This is a no-op stub.
 */
export async function callOpenClawGateway<T = any>(
  _method: string,
  _params?: Record<string, any>,
  _timeoutMs?: number,
): Promise<T> {
  logger.warn('callOpenClawGateway called but OpenClaw integration has been removed')
  throw new Error('OpenClaw gateway integration has been removed')
}
