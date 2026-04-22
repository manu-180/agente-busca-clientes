/**
 * Genera `src/lib/locations-ar.ts` desde la API Georef (datos.gob.ar).
 * Incluye las 24 jurisdicciones y todas las localidades devueltas por el servicio.
 *
 * Uso: node scripts/fetch-locations-ar.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '..', 'src', 'lib', 'locations-ar.ts')

const BASE = 'https://apis.datos.gob.ar/georef/api'
const PAGE = 500

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

async function fetchAllLocalidades(provinciaId) {
  const seen = new Set()
  const nombres = []
  let inicio = 0
  let total = null
  for (;;) {
    const url = `${BASE}/localidades?provincia=${provinciaId}&max=${PAGE}&inicio=${inicio}&campos=nombre`
    const data = await getJson(url)
    total = data.total
    for (const loc of data.localidades || []) {
      const n = String(loc.nombre || '').trim()
      if (!n) continue
      if (seen.has(n)) continue
      seen.add(n)
      nombres.push(n)
    }
    inicio += data.cantidad
    if (inicio >= total || data.cantidad === 0) break
  }
  nombres.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  return nombres
}

async function main() {
  const provData = await getJson(`${BASE}/provincias?max=100`)
  const provincias = (provData.provincias || []).slice()
  if (provincias.length !== 24) {
    console.warn('Advertencia: se esperaban 24 provincias, hay', provincias.length)
  }
  provincias.sort((a, b) =>
    String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' })
  )

  const out = []
  let sumLoc = 0
  for (const p of provincias) {
    const nombres = await fetchAllLocalidades(p.id)
    sumLoc += nombres.length
    out.push({ nombre: p.nombre, localidades: nombres })
    process.stdout.write(`  ${p.nombre}: ${nombres.length} localidades\n`)
  }

  const header = `/**
 * Catálogo de localidades: API Georef Argentina (datos.gob.ar).
 * Generado con: node scripts/fetch-locations-ar.mjs
 * Jurisdicciones: 24. Total localidades (deduplicado por nombre en la misma provincia): ${sumLoc}
 */
`

  const body = `export interface Localidad {
  nombre: string
}

export interface Provincia {
  nombre: string
  localidades: Localidad[]
}

export interface Pais {
  codigo: string
  nombre: string
  provincias: Provincia[]
}

/** Evita usar el primer ítem alfabético (p. ej. "11 de Septiembre") como default. */
export const ARGENTINA_SELECCION_INICIAL = {
  provinciaNombre: 'Ciudad Autónoma de Buenos Aires',
  localidadNombre: 'Palermo',
} as const

export function getInitialSeleccionArgentina(pais: Pais): { provincia: string; localidad: string } {
  if (pais.codigo !== 'AR') {
    const p0 = pais.provincias[0]
    return { provincia: p0?.nombre || '', localidad: p0?.localidades[0]?.nombre || '' }
  }
  const prov = pais.provincias.find(
    (p) => p.nombre === ARGENTINA_SELECCION_INICIAL.provinciaNombre
  )
  const loc = prov?.localidades.find(
    (l) => l.nombre === ARGENTINA_SELECCION_INICIAL.localidadNombre
  )
  if (prov && loc) {
    return { provincia: prov.nombre, localidad: loc.nombre }
  }
  const p0 = pais.provincias[0]
  return { provincia: p0?.nombre || '', localidad: p0?.localidades[0]?.nombre || '' }
}

// Por ahora solo Argentina. Se puede extender con más países hispanohablantes.
export const PAISES_HISPANOHABLANTES: Pais[] = [
  {
    codigo: 'AR',
    nombre: 'Argentina',
    provincias: [
${out
  .map((prov) => {
    const locLines = prov.localidades
      .map((n) => `          { nombre: ${JSON.stringify(n)} }`)
      .join(',\n')
    return `      {
        nombre: ${JSON.stringify(prov.nombre)},
        localidades: [
${locLines}
        ],
      }`
  })
  .join(',\n')}
    ],
  },
]

export function getDefaultPais(): Pais {
  return PAISES_HISPANOHABLANTES[0]
}
`


  writeFileSync(outPath, header + body, 'utf8')
  console.log(`\nEscrito ${outPath} (${sumLoc} localidades en total).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
