import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody, qualityReviewSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/event-bus'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const workspaceId = auth.user.workspace_id ?? 1;
    const taskIdsParam = searchParams.get('taskIds')
    const taskId = parseInt(searchParams.get('taskId') || '')

    if (taskIdsParam) {
      const ids = taskIdsParam
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !Number.isNaN(id))

      if (ids.length === 0) {
        return NextResponse.json({ error: 'taskIds must include at least one numeric id' }, { status: 400 })
      }

      const placeholders = ids.map(() => '?').join(',')
      const rows = db.prepare(`
        SELECT * FROM quality_reviews
        WHERE task_id IN (${placeholders}) AND workspace_id = ?
        ORDER BY task_id ASC, created_at DESC
      `).all(...ids, workspaceId) as Array<{ task_id: number; reviewer?: string; status?: string; created_at?: number }>

      const byTask: Record<number, { status?: string; reviewer?: string; created_at?: number } | null> = {}
      for (const id of ids) {
        byTask[id] = null
      }

      for (const row of rows) {
        const existing = byTask[row.task_id]
        if (!existing || (row.created_at || 0) > (existing.created_at || 0)) {
          byTask[row.task_id] = { status: row.status, reviewer: row.reviewer, created_at: row.created_at }
        }
      }

      return NextResponse.json({ latest: byTask })
    }

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    const reviews = db.prepare(`
      SELECT * FROM quality_reviews
      WHERE task_id = ? AND workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(taskId, workspaceId)

    return NextResponse.json({ reviews })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/quality-review error')
    return NextResponse.json({ error: 'Failed to fetch quality reviews' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const validated = await validateBody(request, qualityReviewSchema)
    if ('error' in validated) return validated.error
    const { taskId, reviewer, status, notes } = validated.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1;

    const task = db
      .prepare('SELECT id, title FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId) as any
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const result = db.prepare(`
      INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskId, reviewer, status, notes, workspaceId)

    db_helpers.logActivity(
      'quality_review',
      'task',
      taskId,
      reviewer,
      `Quality review ${status} for task: ${task.title}`,
      { status, notes },
      workspaceId
    )

    // Auto-advance task based on review outcome
    if (status === 'approved') {
      db.prepare('UPDATE tasks SET status = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
        .run('done', taskId, workspaceId)
      eventBus.broadcast('task.status_changed', {
        id: taskId,
        status: 'done',
        previous_status: 'review',
        updated_at: Math.floor(Date.now() / 1000),
      })
    } else if (status === 'rejected') {
      // Increment dispatch_attempts and decide: requeue or fail
      const currentTask = db.prepare('SELECT dispatch_attempts FROM tasks WHERE id = ? AND workspace_id = ?')
        .get(taskId, workspaceId) as { dispatch_attempts: number } | undefined
      const currentAttempts = currentTask?.dispatch_attempts ?? 0
      const newAttempts = currentAttempts + 1
      const maxAegisRetries = 3

      if (newAttempts >= maxAegisRetries) {
        // Too many rejections — move to failed
        const errorMsg = `Aegis rejected ${newAttempts} times. Last: ${notes}`
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
          .run('failed', errorMsg, newAttempts, taskId, workspaceId)
        eventBus.broadcast('task.status_changed', {
          id: taskId,
          status: 'failed',
          previous_status: 'review',
          error_message: errorMsg,
          reason: 'max_aegis_retries_exceeded',
          updated_at: Math.floor(Date.now() / 1000),
        })
      } else {
        // Requeue to assigned for re-dispatch with feedback.
        // Clear resolution so the next attempt starts clean — stale resolution
        // from a previous failed attempt contaminates Aegis review.
        const errorMsg = `Quality review rejected by ${reviewer}: ${notes}`
        db.prepare('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, resolution = NULL, outcome = NULL, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?')
          .run('assigned', errorMsg, newAttempts, taskId, workspaceId)

        // Add rejection as a comment so the worker agent sees it on next dispatch
        db.prepare('INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, unixepoch(), ?)')
          .run(taskId, reviewer, `Quality Review Rejected (attempt ${newAttempts}/${maxAegisRetries}):\n${notes}`, workspaceId)

        eventBus.broadcast('task.status_changed', {
          id: taskId,
          status: 'assigned',
          previous_status: 'review',
          error_message: errorMsg,
          reason: 'aegis_rejection',
          updated_at: Math.floor(Date.now() / 1000),
        })
      }
    }

    return NextResponse.json({ success: true, id: result.lastInsertRowid })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/quality-review error')
    return NextResponse.json({ error: 'Failed to create quality review' }, { status: 500 })
  }
}
