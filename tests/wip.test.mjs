import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const toModule = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')
const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')
const api = read('../src/lib/api.ts').replace('import.meta.env.DEV', 'true').replace('import.meta.env.VITE_API_BASE_URL', 'undefined').replace('import.meta.env.VITE_CALENDAR_URL', 'undefined').replace('import.meta.env.VITE_PROJECT_CONFIG_URL', 'undefined')
const lib = await import(toModule(read('../src/lib/wip.ts').replace("from './api'", `from '${toModule(api)}'`)))

const row = (o) => ({ id: o.id, tipo: 'tiempo', origen: 'aptus', estado: 'sin_liberar', fecha: '2026-11-01', cliente: 'Cliente A', cliente_id: '1', proyecto: 'P1', proyecto_id: 1, moneda: 'MXN', horas: 1, importe: 100, responsable: 'Ana', ...o })
const data = {
  reporte: 'wip', generado_en: '2026-11-14T00:00:00Z', renglones: 4, totales: [],
  responsables: [
    { responsable: 'Ana', totales: [], clientes: [{ cliente_id: '1', cliente: 'Cliente A', totales: [], proyectos: [{ proyecto_id: 1, proyecto: 'P1', totales: [], renglones: [
      row({ id: 'a1', horas: 1.25, importe: 100.1 }), row({ id: 'a2', tipo: 'gasto', horas: 0, importe: 0.2, descripcion: 'Copias Álvaro' }),
    ] }] }] },
    { responsable: 'Sin responsable', totales: [], clientes: [{ cliente_id: '2', cliente: 'Cliente B', totales: [], proyectos: [{ proyecto_id: null, proyecto: 'Sin proyecto', totales: [], renglones: [
      row({ id: 'b1', responsable: 'Sin responsable', cliente: 'Cliente B', cliente_id: '2', proyecto: 'Sin proyecto', proyecto_id: null, moneda: 'USD', importe: 50, origen: 'books', estado: 'sin_facturar' }),
      row({ id: 'b2', responsable: 'Sin responsable', cliente: 'Cliente B', cliente_id: '2', proyecto: 'Sin proyecto', proyecto_id: null, tipo: 'fijo', horas: 0, importe: 1000, fecha: '2026-11-05' }),
    ] }] }] },
  ],
}

test('buildQuery: pendiente por omisión, tipos solo si no son todos, fechas y forzar', () => {
  assert.equal(lib.buildQuery(lib.FILTROS_INICIALES), '?estado=pendiente')
  assert.equal(lib.buildQuery({ ...lib.FILTROS_INICIALES, vista: 'todo' }), '')
  assert.equal(lib.buildQuery({ ...lib.FILTROS_INICIALES, tipos: ['gasto', 'tiempo'], moneda: 'USD', desde: '2026-01-01', origen: 'books' }, true),
    '?estado=pendiente&tipo=tiempo%2Cgasto&origen=books&moneda=USD&desde=2026-01-01&forzar=1')
  assert.equal(lib.buildQuery({ ...lib.FILTROS_INICIALES, vista: 'facturado', tipos: ['tiempo', 'gasto', 'fijo'] }), '?estado=facturado')
  assert.equal(lib.validateFiltros({ ...lib.FILTROS_INICIALES, desde: '2026-02-01', hasta: '2026-01-01' }), 'La fecha inicial es posterior a la final.')
})

test('alternarTipo: pulsar quita; el último no se quita; todos = []', () => {
  assert.deepEqual(lib.alternarTipo([], 'tiempo'), ['gasto', 'fijo'])
  assert.deepEqual(lib.alternarTipo(['gasto', 'fijo'], 'tiempo'), [])
  const solo = ['gasto']
  assert.equal(lib.alternarTipo(solo, 'gasto'), solo)
  assert.deepEqual(lib.alternarTipo(['fijo'], 'tiempo'), ['tiempo', 'fijo'])
})

test('aplanar, agrupar y sumar por moneda sin mezclar', () => {
  const rows = lib.flatten(data)
  assert.equal(rows.length, 4)
  const tree = lib.buildTree(rows)
  assert.deepEqual(tree.map(r => r.responsable), ['Ana', 'Sin responsable'])
  assert.deepEqual(tree[0].totales, [{ moneda: 'MXN', renglones: 2, horas: 1.25, importe_tiempo: 100.1, importe_gastos: 0.2, importe_fijos: 0, importe: 100.3 }])
  assert.deepEqual(tree[1].totales.map(t => [t.moneda, t.importe]), [['MXN', 1000], ['USD', 50]])
  assert.deepEqual(tree[1].clientes[0].proyectos[0].renglones.map(r => r.id), ['b2', 'b1']) // recientes primero
  assert.deepEqual(lib.responsablesDe(rows), ['Ana', 'Sin responsable'])
})

test('filtro en pantalla: texto sin acentos y responsable', () => {
  const rows = lib.flatten(data)
  assert.deepEqual(lib.filterRows(rows, { texto: 'alvaro copias' }).map(r => r.id), ['a2'])
  assert.deepEqual(lib.filterRows(rows, { responsable: 'Sin responsable' }).map(r => r.id), ['b1', 'b2'])
  assert.equal(lib.filterRows(rows, { texto: 'cliente b', responsable: 'Ana' }).length, 0)
})

test('CSV: BOM, comillas escapadas y sin fórmulas', () => {
  const csv = lib.toCsv([row({ id: 'x', descripcion: '=HYPERLINK("http://x")', cliente: 'A, "B"' })])
  assert.ok(csv.startsWith('﻿Responsable,Cliente'))
  assert.ok(csv.includes('"A, ""B"""'))
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`))
})

test('getWip: { listo: false } se devuelve para reintentar; error de la API con su mensaje; forma inesperada falla', async () => {
  const original = globalThis.fetch
  const urls = []
  try {
    globalThis.fetch = async u => { urls.push(u); return new Response(JSON.stringify({ listo: false, actualizando: true }), { status: 200 }) }
    assert.deepEqual(await lib.getWip('636939444', lib.FILTROS_INICIALES), { listo: false, actualizando: true })
    assert.equal(urls[0], '/api/636939444/wip?estado=pendiente')
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Filtro inválido: estado.' }), { status: 400 })
    await assert.rejects(lib.getWip('1', lib.FILTROS_INICIALES), /Filtro inválido/)
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    await assert.rejects(lib.getWip('1', lib.FILTROS_INICIALES), /inesperada/)
    globalThis.fetch = async () => { throw new TypeError('fail') }
    await assert.rejects(lib.getWip('1', lib.FILTROS_INICIALES), /conexión/)
  } finally { globalThis.fetch = original }
})
