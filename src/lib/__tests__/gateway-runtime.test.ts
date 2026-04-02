import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  config: { openclawConfigPath: '' },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

describe('registerMcAsDashboard', () => {
  it('returns not-registered when openclaw config writing is removed', async () => {
    const { registerMcAsDashboard } = await import('@/lib/gateway-runtime')
    const result = registerMcAsDashboard('https://mc.example.com/dashboard')
    expect(result).toEqual({ registered: false, alreadySet: false })
  })
})
