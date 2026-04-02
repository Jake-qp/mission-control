import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runCommand } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json().catch(() => ({}))
    const customMessage =
      typeof body?.message === 'string' ? body.message.trim() : ''

    const db = getDatabase()
    const agent: any = isNaN(Number(agentId))
      ? db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId)
      : db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!agent.session_key) {
      return NextResponse.json(
        { error: 'Agent has no session key configured' },
        { status: 400 }
      )
    }

    const message =
      customMessage ||
      `Wake up check-in for ${agent.name}. Please review assigned tasks and notifications.`

    // TODO: Replace with generic gateway API call (OpenClaw CLI removed)
    logger.warn({ session: agent.session_key }, 'Agent wake: OpenClaw CLI removed, wake message not sent via gateway')

    db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)

    return NextResponse.json({
      success: true,
      session_key: agent.session_key,
      stdout: 'Wake message queued (gateway CLI removed)'
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/wake error')
    return NextResponse.json({ error: 'Failed to wake agent' }, { status: 500 })
  }
}
