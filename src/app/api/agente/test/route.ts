import { NextResponse } from 'next/server'
import { verificarConexionWassenger } from '@/lib/wassenger'

export async function GET() {
  const result = await verificarConexionWassenger()
  return NextResponse.json(result)
}
