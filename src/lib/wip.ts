import { API_BASE } from './api'

// Reporte WIP de ReportesSandbox vía aptus_report_services (solo lectura). La API agrupa
// Responsable → Cliente → Proyecto; aquí se aplana para filtrar en pantalla (texto, responsable) y se
// vuelve a agrupar con los mismos totales por moneda.
export type Tipo = 'tiempo' | 'gasto' | 'fijo'
export type Origen = 'aptus' | 'books'
export type Estado = 'sin_liberar' | 'liberado' | 'en_prebill' | 'sin_facturar' | 'facturado'

export interface Renglon {
  id: string; tipo: Tipo; origen: Origen; estado: Estado; fecha: string
  cliente_id?: string | null; cliente: string; proyecto_id?: number | null; zoho_project_id?: string | null; proyecto: string
  moneda: string; abogado?: string | null; abogado_id?: number | null; horas: number; tarifa?: number | null; importe: number
  tarifa_referencia?: boolean; descripcion?: string | null; tarea?: string | null; responsable: string
  prebill?: { id: number; status: string; factura?: string | null } | null
  zoho_invoice_number?: string | null
}
export interface Total { moneda: string; renglones: number; horas: number; importe_tiempo: number; importe_gastos: number; importe_fijos: number; importe: number }
interface ApiProyecto { proyecto_id?: number | null; zoho_project_id?: string | null; proyecto: string; totales: Total[]; renglones: Renglon[] }
interface ApiCliente { cliente_id?: string | null; cliente: string; totales: Total[]; proyectos: ApiProyecto[] }
export interface WipResponse {
  reporte: 'wip'; generado_en: string; actualizando?: boolean
  cache?: { books_cargado_en?: string; edad_s?: number; vigencia_s?: number; actualizando?: boolean }
  rol_responsable?: string; renglones: number; omitidos?: { duplicados_respaldados?: number; no_facturables?: number }
  totales: Total[]; responsables: { responsable: string; totales: Total[]; clientes: ApiCliente[] }[]
}
export interface Pendiente { listo: false; actualizando?: boolean }

// ── Filtros que van a la API ──
export type Vista = 'pendiente' | 'todo' | 'facturado'
export interface Filtros { vista: Vista; tipos: Tipo[]; origen: '' | Origen; moneda: string; desde: string; hasta: string }
export const FILTROS_INICIALES: Filtros = { vista: 'pendiente', tipos: [], origen: '', moneda: '', desde: '', hasta: '' }
export const TIPOS: Tipo[] = ['tiempo', 'gasto', 'fijo']

// [] = todos. Pulsar un tipo activo lo quita; el último activo no se puede quitar (devuelve el mismo arreglo).
export function alternarTipo(tipos: Tipo[], t: Tipo): Tipo[] {
  const activos = tipos.length ? tipos : TIPOS
  const next = activos.includes(t) ? activos.filter(x => x !== t) : [...activos, t]
  if (!next.length) return tipos
  return next.length === TIPOS.length ? [] : TIPOS.filter(x => next.includes(x))
}

export function buildQuery(f: Filtros, forzar = false): string {
  const q = new URLSearchParams()
  if (f.vista === 'pendiente') q.set('estado', 'pendiente')
  if (f.vista === 'facturado') q.set('estado', 'facturado')
  if (f.tipos.length && f.tipos.length < TIPOS.length) q.set('tipo', TIPOS.filter(t => f.tipos.includes(t)).join(','))
  if (f.origen) q.set('origen', f.origen)
  if (f.moneda) q.set('moneda', f.moneda)
  if (f.desde) q.set('desde', f.desde)
  if (f.hasta) q.set('hasta', f.hasta)
  if (forzar) q.set('forzar', '1')
  const s = q.toString()
  return s ? '?' + s : ''
}

export function validateFiltros(f: Filtros): string | null {
  if (f.desde && f.hasta && f.desde > f.hasta) return 'La fecha inicial es posterior a la final.'
  return null
}

// ── Lectura ──
const isPendiente = (d: unknown): d is Pendiente => !!d && typeof d === 'object' && (d as { listo?: unknown }).listo === false
const isWip = (d: unknown): d is WipResponse => !!d && typeof d === 'object' && (d as WipResponse).reporte === 'wip' && Array.isArray((d as WipResponse).responsables)

export async function getWip(org: string, f: Filtros, { forzar = false, signal }: { forzar?: boolean; signal?: AbortSignal } = {}): Promise<WipResponse | Pendiente> {
  let response: Response
  try { response = await fetch(`${API_BASE}/${encodeURIComponent(org)}/wip${buildQuery(f, forzar)}`, { signal }) }
  catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new Error('No hay conexión con el servicio de reportes.')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'No se pudo cargar el WIP.')
  if (isPendiente(data)) return data
  if (!isWip(data)) throw new Error('Respuesta inesperada del servicio de reportes.')
  return data
}

// ── Aplanar, filtrar en pantalla y volver a agrupar ──
export function flatten(data: WipResponse): Renglon[] {
  return data.responsables.flatMap(r => r.clientes.flatMap(c => c.proyectos.flatMap(p => p.renglones.map(x => ({
    ...x, responsable: x.responsable || r.responsable, cliente: x.cliente || c.cliente, cliente_id: x.cliente_id ?? c.cliente_id ?? null,
    proyecto: x.proyecto || p.proyecto, proyecto_id: x.proyecto_id ?? p.proyecto_id ?? null, zoho_project_id: x.zoho_project_id ?? p.zoho_project_id ?? null,
  })))))
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function filterRows(rows: Renglon[], { texto = '', responsable = '' }: { texto?: string; responsable?: string }): Renglon[] {
  const words = norm(texto.trim()).split(/\s+/).filter(Boolean)
  return rows.filter(r => {
    if (responsable && r.responsable !== responsable) return false
    if (!words.length) return true
    const hay = norm([r.cliente, r.proyecto, r.abogado, r.descripcion, r.tarea, r.prebill?.factura, r.zoho_invoice_number].filter(Boolean).join(' '))
    return words.every(w => hay.includes(w))
  })
}

const round2 = (n: number) => Math.round(n * 100) / 100
export function sumTotals(rows: Renglon[]): Total[] {
  const map = new Map<string, Total>()
  for (const r of rows) {
    const t = map.get(r.moneda) ?? { moneda: r.moneda, renglones: 0, horas: 0, importe_tiempo: 0, importe_gastos: 0, importe_fijos: 0, importe: 0 }
    t.renglones += 1
    t.horas += Number(r.horas) || 0
    const imp = Number(r.importe) || 0
    if (r.tipo === 'tiempo') t.importe_tiempo += imp
    else if (r.tipo === 'gasto') t.importe_gastos += imp
    else t.importe_fijos += imp
    t.importe += imp
    map.set(r.moneda, t)
  }
  const orden = ['MXN', 'USD', 'EUR']
  return [...map.values()]
    .map(t => ({ ...t, horas: round2(t.horas), importe_tiempo: round2(t.importe_tiempo), importe_gastos: round2(t.importe_gastos), importe_fijos: round2(t.importe_fijos), importe: round2(t.importe) }))
    .sort((a, b) => (orden.indexOf(a.moneda) + 1 || 9) - (orden.indexOf(b.moneda) + 1 || 9) || a.moneda.localeCompare(b.moneda))
}

export interface NodoProyecto { key: string; proyecto: string; totales: Total[]; renglones: Renglon[] }
export interface NodoCliente { key: string; cliente: string; totales: Total[]; proyectos: NodoProyecto[] }
export interface NodoResponsable { key: string; responsable: string; totales: Total[]; clientes: NodoCliente[] }

const SIN_RESPONSABLE = 'Sin responsable'
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) { const k = key(r); const list = m.get(k); if (list) list.push(r); else m.set(k, [r]) }
  return m
}
const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' })

// Responsables por nombre ("Sin responsable" al final); clientes y proyectos por nombre; renglones por fecha (recientes primero).
export function buildTree(rows: Renglon[]): NodoResponsable[] {
  const resp = [...groupBy(rows, r => r.responsable || SIN_RESPONSABLE)].sort(([a], [b]) => (a === SIN_RESPONSABLE ? 1 : 0) - (b === SIN_RESPONSABLE ? 1 : 0) || byName(a, b))
  return resp.map(([responsable, rRows]) => ({
    key: 'r:' + responsable, responsable, totales: sumTotals(rRows),
    clientes: [...groupBy(rRows, r => r.cliente_id || r.cliente)].map(([cKey, cRows]) => ({
      key: `r:${responsable}|c:${cKey}`, cliente: cRows[0].cliente, totales: sumTotals(cRows),
      proyectos: [...groupBy(cRows, r => String(r.proyecto_id ?? r.zoho_project_id ?? r.proyecto))].map(([pKey, pRows]) => ({
        key: `r:${responsable}|c:${cKey}|p:${pKey}`, proyecto: pRows[0].proyecto, totales: sumTotals(pRows),
        renglones: [...pRows].sort((a, b) => b.fecha.localeCompare(a.fecha) || a.id.localeCompare(b.id)),
      })).sort((a, b) => byName(a.proyecto, b.proyecto)),
    })).sort((a, b) => byName(a.cliente, b.cliente)),
  }))
}

export const responsablesDe = (rows: Renglon[]) => [...new Set(rows.map(r => r.responsable || SIN_RESPONSABLE))].sort((a, b) => (a === SIN_RESPONSABLE ? 1 : 0) - (b === SIN_RESPONSABLE ? 1 : 0) || byName(a, b))

// ── Presentación ──
export const ESTADO_LABEL: Record<Estado, string> = {
  sin_liberar: 'Sin liberar', liberado: 'Liberado', en_prebill: 'En Prebill', sin_facturar: 'Sin facturar (Books)', facturado: 'Facturado',
}
export const TIPO_LABEL: Record<Tipo, string> = { tiempo: 'Tiempo', gasto: 'Gasto', fijo: 'Honorario fijo' }
export const TIPO_PLURAL: Record<Tipo, string> = { tiempo: 'Tiempos', gasto: 'Gastos', fijo: 'Fijos' }

export function formatMoney(n: number, moneda?: string) {
  const s = (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return moneda ? `${s} ${moneda}` : s
}
export const formatHoras = (n: number) => (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
export function formatFecha(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
export function edadCache(segundos?: number) {
  if (segundos == null || !Number.isFinite(segundos)) return ''
  if (segundos < 90) return 'hace un momento'
  const min = Math.round(segundos / 60)
  if (min < 90) return `hace ${min} min`
  return `hace ${Math.round(min / 60)} h`
}

// CSV con BOM para que Excel respete acentos. Separador coma; comillas dobles escapadas.
export function toCsv(rows: Renglon[]): string {
  const cols: [string, (r: Renglon) => unknown][] = [
    ['Responsable', r => r.responsable], ['Cliente', r => r.cliente], ['Proyecto', r => r.proyecto], ['Fecha', r => r.fecha],
    ['Tipo', r => TIPO_LABEL[r.tipo] ?? r.tipo], ['Origen', r => r.origen === 'aptus' ? 'Aptus' : 'Books'], ['Estado', r => ESTADO_LABEL[r.estado] ?? r.estado],
    ['Abogado', r => r.abogado ?? ''], ['Tarea', r => r.tarea ?? ''], ['Descripción', r => r.descripcion ?? ''], ['Horas', r => r.horas],
    ['Tarifa', r => r.tarifa ?? ''], ['Tarifa de referencia', r => r.tarifa_referencia ? 'Sí' : ''], ['Importe', r => r.importe], ['Moneda', r => r.moneda],
    ['Prebill', r => r.prebill?.id ?? ''], ['Factura', r => r.prebill?.factura ?? r.zoho_invoice_number ?? ''],
  ]
  // Texto que empieza con = + - @ se antepone con ' para que Excel no lo tome como fórmula.
  const cell = (v: unknown) => {
    let s = String(v ?? '')
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [cols.map(c => c[0]).join(','), ...rows.map(r => cols.map(([, f]) => cell(f(r))).join(','))].join('\r\n')
}
