import { NextRequest, NextResponse } from 'next/server'
import { listDemos } from '@/lib/demos-repo'
import { matchDemoFromTexts } from '@/lib/demo-match'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { texto, rubro } = body as { texto?: string; rubro?: string }

    if (!texto && !rubro) {
      return NextResponse.json(
        { error: 'Se requiere al menos texto o rubro' },
        { status: 400 }
      )
    }

    const demos = await listDemos()
    const result = matchDemoFromTexts(demos, {
      rubroGuardado: rubro,
      textos: texto ? [texto] : [],
    })

    return NextResponse.json({
      demo: result.demo,
      score: result.score,
      reason: result.reason,
    })
  } catch (e) {
    console.error('[DEMOS TEST] Error:', e)
    return NextResponse.json(
      { error: 'No se pudo probar el matcher de demos' },
      { status: 500 }
    )
  }
}

