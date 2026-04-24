import { NextRequest, NextResponse } from 'next/server'
import { listDemos, createDemo, updateDemo, deleteDemo } from '@/lib/demos-repo'

export async function GET() {
  const demos = await listDemos({ includeInactive: true })
  return NextResponse.json({ demos })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const result = await createDemo(body)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { id, ...rest } = body || {}

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
  }

  const result = await updateDemo(id, rest)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const { id } = body || {}

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
  }

  const result = await deleteDemo(id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

