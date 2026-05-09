#!/usr/bin/env node
/**
 * Valida `src/lib/localidades-principales-ar.ts` contra
 * `src/lib/locations-ar.ts`:
 *   - Lista nombres "huérfanos" (declarados como principales pero
 *     ausentes del catálogo Georef → no van a matchear nunca).
 *   - Reporta el conteo final por provincia y el ahorro global.
 *
 * Uso (desde `apex-leads/`):
 *   node scripts/validate-localidades-principales.mjs
 *
 * Salida no-zero si encuentra huérfanos: útil para correr en CI más
 * adelante. Por ahora sólo informa.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const LOCATIONS_PATH = join(ROOT, 'src/lib/locations-ar.ts')
const PRINCIPALES_PATH = join(ROOT, 'src/lib/localidades-principales-ar.ts')

/**
 * Parser muy simple: lee el archivo TS como texto y extrae cada bloque
 * `nombre: "Provincia"` seguido de su array `localidades: [...]`.
 *
 * No usamos el módulo TS directamente porque correrlo desde Node.mjs
 * implicaría tsx o un build. El catálogo es estable y este parser
 * cubre todos los casos del archivo generado por `fetch-locations-ar.mjs`.
 */
function parseCatalogo(textoTS) {
  const provinciaPattern = /\{\s*nombre:\s*"([^"]+)",\s*localidades:\s*\[([\s\S]*?)\]\s*,?\s*\}/g
  const localidadPattern = /\{\s*nombre:\s*"([^"]+)"\s*\}/g

  /** @type {Record<string, Set<string>>} */
  const out = {}
  let match
  while ((match = provinciaPattern.exec(textoTS)) !== null) {
    const provincia = match[1]
    const cuerpo = match[2]
    const set = new Set()
    let m2
    while ((m2 = localidadPattern.exec(cuerpo)) !== null) {
      set.add(m2[1])
    }
    if (provincia in out) {
      // Si una provincia aparece dos veces (no esperado), unimos.
      for (const v of set) out[provincia].add(v)
    } else {
      out[provincia] = set
    }
  }
  return out
}

/**
 * Extrae el RAW del archivo de principales sin necesidad de tsx.
 * Lee el bloque `const RAW: Record<string, ListaPrincipales> = { ... }`
 * y parsea claves+arrays con regex.
 */
function parsePrincipales(textoTS) {
  const inicio = textoTS.indexOf('const RAW:')
  if (inicio === -1) throw new Error('No encontré la const RAW en el archivo de principales')

  // Levantamos todo a partir de ahí y vamos balanceando llaves.
  let i = textoTS.indexOf('{', inicio)
  if (i === -1) throw new Error('No encontré la apertura del objeto RAW')
  let depth = 0
  let fin = -1
  for (; i < textoTS.length; i++) {
    const c = textoTS[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        fin = i
        break
      }
    }
  }
  if (fin === -1) throw new Error('No pude balancear las llaves de RAW')
  const cuerpo = textoTS.slice(textoTS.indexOf('{', inicio) + 1, fin)

  /** @type {Record<string, string[] | '*'>} */
  const out = {}

  // Split en lineas que representan entradas top-level.
  // Patron: 'Provincia': [ ... ],  o  'Provincia': '*',
  const entryPattern = /['"]([^'"]+)['"]\s*:\s*(\*|'\*'|"\*"|\[[\s\S]*?\])\s*,/g
  let m
  while ((m = entryPattern.exec(cuerpo)) !== null) {
    const prov = m[1]
    const valor = m[2].trim()
    if (valor === "'*'" || valor === '"*"' || valor === '*') {
      out[prov] = '*'
    } else {
      // Es un array literal [ 'a', 'b', ... ]
      const items = []
      const itemPattern = /['"]([^'"]+)['"]/g
      let m2
      while ((m2 = itemPattern.exec(valor)) !== null) {
        items.push(m2[1])
      }
      out[prov] = items
    }
  }
  return out
}

const catalogoTexto = readFileSync(LOCATIONS_PATH, 'utf8')
const principalesTexto = readFileSync(PRINCIPALES_PATH, 'utf8')

const catalogo = parseCatalogo(catalogoTexto)
const principales = parsePrincipales(principalesTexto)

const provinciasCatalogo = new Set(Object.keys(catalogo))
const provinciasPrincipales = new Set(Object.keys(principales))

console.log('═'.repeat(78))
console.log('  Validación de localidades principales (modo eficiencia)')
console.log('═'.repeat(78))

// 1) Provincias presentes en principales pero NO en el catálogo (typo)
const provHuerfanas = [...provinciasPrincipales].filter((p) => !provinciasCatalogo.has(p))
if (provHuerfanas.length > 0) {
  console.error('\n❌ Provincias declaradas en principales que no existen en el catálogo:')
  for (const p of provHuerfanas) console.error(`     - "${p}"`)
}

// 2) Provincias del catálogo sin entrada en principales (degrada a "todas")
const provSinDatos = [...provinciasCatalogo].filter((p) => !provinciasPrincipales.has(p))
if (provSinDatos.length > 0) {
  console.warn('\n⚠️  Provincias del catálogo SIN datos curados (modo eficiencia las dejará pasar enteras):')
  for (const p of provSinDatos) console.warn(`     - "${p}"`)
}

// 3) Por provincia: huérfanos (declarados pero no en catálogo) + ahorro
let totalCatalogo = 0
let totalPrincipales = 0
let totalHuerfanos = 0

console.log('\nResumen por provincia (✓ = existe en catálogo, ✗ = nombre huérfano):\n')

const filas = []

for (const prov of [...provinciasCatalogo].sort()) {
  const setCatalogo = catalogo[prov]
  const lista = principales[prov]

  totalCatalogo += setCatalogo.size

  if (!lista) {
    // Sin datos: pasan todas
    totalPrincipales += setCatalogo.size
    filas.push({
      prov,
      catalogo: setCatalogo.size,
      principales: setCatalogo.size,
      huerfanos: 0,
      nota: 'sin datos curados (pasan todas)',
    })
    continue
  }

  if (lista === '*') {
    totalPrincipales += setCatalogo.size
    filas.push({
      prov,
      catalogo: setCatalogo.size,
      principales: setCatalogo.size,
      huerfanos: 0,
      nota: 'sentinela "*" (todas)',
    })
    continue
  }

  // Lista explícita: filtramos contra catálogo
  const dedupCandidatos = new Set(lista)
  const validos = [...dedupCandidatos].filter((n) => setCatalogo.has(n))
  const huerfanos = [...dedupCandidatos].filter((n) => !setCatalogo.has(n))

  totalPrincipales += validos.length
  totalHuerfanos += huerfanos.length

  filas.push({
    prov,
    catalogo: setCatalogo.size,
    principales: validos.length,
    huerfanos: huerfanos.length,
    nota: huerfanos.length > 0 ? `huérfanos: ${huerfanos.join(', ')}` : '',
  })
}

const padNombre = Math.max(...filas.map((f) => f.prov.length))
console.log(
  '  ' +
    'Provincia'.padEnd(padNombre) +
    '  catálogo  principales  ahorro  notas',
)
console.log('  ' + '-'.repeat(padNombre + 50))
for (const f of filas) {
  const ahorro =
    f.catalogo > 0
      ? `${(((f.catalogo - f.principales) / f.catalogo) * 100).toFixed(0)}%`
      : '—'
  console.log(
    `  ${f.prov.padEnd(padNombre)}  ${String(f.catalogo).padStart(8)}  ${String(
      f.principales,
    ).padStart(11)}  ${ahorro.padStart(6)}  ${f.nota}`,
  )
}

const ahorroTotal = totalCatalogo > 0 ? (((totalCatalogo - totalPrincipales) / totalCatalogo) * 100) : 0
console.log('\n' + '═'.repeat(78))
console.log(`  TOTAL catálogo       : ${totalCatalogo.toLocaleString('es-AR')} localidades`)
console.log(`  TOTAL modo eficiencia: ${totalPrincipales.toLocaleString('es-AR')} localidades`)
console.log(`  Ahorro de búsquedas  : ${ahorroTotal.toFixed(1)}%`)
if (totalHuerfanos > 0) {
  console.log(`  Huérfanos a limpiar  : ${totalHuerfanos}  ← revisalos arriba`)
}
console.log('═'.repeat(78))

if (provHuerfanas.length > 0) {
  process.exit(1)
}
process.exit(0)
