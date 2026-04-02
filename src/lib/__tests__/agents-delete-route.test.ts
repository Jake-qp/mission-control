import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const removeAgentFromConfig = vi.fn()
const prepare = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/command', () => ({
  runCommand: vi.fn(),
}))

vi.mock('@/lib/agent-sync', () => ({
  writeAgentToConfig: vi.fn(),
  enrichAgentConfigFromWorkspace: vi.fn((value) => value),
  removeAgentFromConfig,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare })),
  db_helpers: {
    logActivity: vi.fn(),
  },
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

describe('DELETE /api/agents/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
    requireRole.mockReturnValue({ user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1 } })
    removeAgentFromConfig.mockReset()
    prepare.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('deletes agent from MC database', async () => {
    const agent = { id: 7, name: 'neo', role: 'tester', config: JSON.stringify({}) }
    const selectStmt = { get: vi.fn(() => agent) }
    const deleteStmt = { run: vi.fn() }
    prepare.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT * FROM agents')) return selectStmt
      if (sql.startsWith('DELETE FROM agents')) return deleteStmt
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const { DELETE } = await import('@/app/api/agents/[id]/route')
    const request = new NextRequest('http://localhost/api/agents/7', {
      method: 'DELETE',
      body: JSON.stringify({ remove_workspace: false }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: '7' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(deleteStmt.run).toHaveBeenCalledWith(7, 1)
    expect(body.success).toBe(true)
  })
})
