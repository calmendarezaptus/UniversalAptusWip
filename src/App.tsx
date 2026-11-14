import { useEffect, useMemo, useRef, useState } from 'react'
import 'animate.css'
import { Toaster } from 'sonner'
import { Download, Hourglass, ListTree, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusModal, type StatusModalType } from '@/components/StatusModal'
import { ThemeMenu } from '@/components/ThemeMenu'
import { Montos, WipTree } from '@/components/WipTree'
import { cn } from '@/lib/utils'
import { CALENDAR_URL, PROJECT_CONFIG_URL } from '@/lib/api'
import { inputCls, labelCls, useTheme } from '@/lib/ui'
import {
  alternarTipo, buildTree, edadCache, filterRows, FILTROS_INICIALES, flatten, formatHoras, formatMoney, getWip, responsablesDe, sumTotals, TIPO_PLURAL, TIPOS, toCsv,
  validateFiltros, type Filtros, type Tipo, type Vista, type WipResponse,
} from '@/lib/wip'

type Modal = { isOpen: boolean; type: StatusModalType; title: string; message: string }
const REINTENTO_MS = 4000
const MAX_INTENTOS = 25 // ~2 min contando los 15 s que espera la API en cada intento

const VISTAS: { id: Vista; label: string }[] = [
  { id: 'pendiente', label: 'Pendiente' },
  { id: 'facturado', label: 'Facturado' },
  { id: 'todo', label: 'Todo' },
]
const segCls = (active: boolean) => cn('px-3 h-8 text-xs font-semibold rounded-md transition-all whitespace-nowrap',
  active ? 'bg-white text-theme-text shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-theme-light border border-transparent')

function App() {
  const [theme, setTheme] = useTheme()
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [statusModal, setStatusModal] = useState<Modal>({ isOpen: false, type: 'info', title: '', message: '' })

  useEffect(() => {
    const orgId = new URLSearchParams(window.location.search).get('organization_id')
    if (!orgId) setStatusModal({ isOpen: true, type: 'error', title: 'Error de Inicialización', message: 'No se detectó la organización relacionada. Es necesario incluir el parámetro "organization_id" en la URL.' })
    else setOrganizationId(orgId)
  }, [])

  // ── Filtros que van a la API (aplicados con "Aplicar"; la vista y el tipo cambian al momento) ──
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES)
  const [borrador, setBorrador] = useState({ desde: '', hasta: '', moneda: '', origen: '' as Filtros['origen'] })
  const errorFechas = validateFiltros({ ...filtros, ...borrador })

  // ── Carga con reintento mientras ReportesSandbox prepara la copia ({ listo: false }) ──
  const [data, setData] = useState<WipResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [preparando, setPreparando] = useState(0)
  const [loadError, setLoadError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const load = (forzar = false) => {
    if (!organizationId) return
    controller.current?.abort(); window.clearTimeout(timer.current)
    const ctrl = new AbortController(); controller.current = ctrl
    setLoading(true); setLoadError(''); setPreparando(0)
    const attempt = async (n: number, conForzar: boolean) => {
      try {
        const result = await getWip(organizationId, filtros, { forzar: conForzar, signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        if ('listo' in result) {
          if (n >= MAX_INTENTOS) { setLoading(false); setPreparando(0); setLoadError('El reporte sigue preparándose en el servidor. Intenta de nuevo en unos minutos.'); return }
          setPreparando(n)
          timer.current = window.setTimeout(() => void attempt(n + 1, false), REINTENTO_MS)
          return
        }
        setData(result); setLoading(false); setPreparando(0)
      } catch (error) {
        if (ctrl.signal.aborted || (error as Error)?.name === 'AbortError') return
        setLoading(false); setPreparando(0)
        setLoadError(error instanceof Error ? error.message : 'No se pudo cargar el WIP.')
      }
    }
    void attempt(1, forzar)
  }
  useEffect(() => { load() }, [organizationId, filtros]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { controller.current?.abort(); window.clearTimeout(timer.current) }, [])

  // ── Filtros en pantalla ──
  const [texto, setTexto] = useState('')
  const [responsable, setResponsable] = useState('')
  const rows = useMemo(() => (data ? flatten(data) : []), [data])
  const responsables = useMemo(() => responsablesDe(rows), [rows])
  useEffect(() => { if (responsable && !responsables.includes(responsable)) setResponsable('') }, [responsables, responsable])
  const visibles = useMemo(() => filterRows(rows, { texto, responsable }), [rows, texto, responsable])
  const tree = useMemo(() => buildTree(visibles), [visibles])
  const totales = useMemo(() => sumTotals(visibles), [visibles])

  // Responsables abiertos por omisión; clientes y proyectos cerrados.
  const [open, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => { setOpen(new Set(tree.map(r => r.key))) }, [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (key: string) => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const expandAll = () => setOpen(new Set(tree.flatMap(r => [r.key, ...r.clientes.flatMap(c => [c.key, ...c.proyectos.map(p => p.key)])])))
  const collapseAll = () => setOpen(new Set())

  const toggleTipo = (t: Tipo) => setFiltros(f => {
    const tipos = alternarTipo(f.tipos, t)
    return tipos === f.tipos ? f : { ...f, tipos }
  })
  const aplicar = () => { if (!errorFechas) setFiltros(f => ({ ...f, ...borrador })) }
  const pendientesDeAplicar = borrador.desde !== filtros.desde || borrador.hasta !== filtros.hasta || borrador.moneda !== filtros.moneda || borrador.origen !== filtros.origen
  const limpiar = () => { setBorrador({ desde: '', hasta: '', moneda: '', origen: '' }); setFiltros(FILTROS_INICIALES); setTexto(''); setResponsable('') }

  function descargarCsv() {
    const blob = new Blob([toCsv(visibles)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `WIP-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  function handleCancel() {
    const params = new URLSearchParams(window.location.search)
    const org = organizationId || params.get('organization_id') || ''
    try {
      const target = new URL(params.get('origin') || CALENDAR_URL)
      if (!target.searchParams.get('organization_id') && org) target.searchParams.set('organization_id', org)
      target.searchParams.set('_t', Date.now().toString())
      window.location.href = target.toString()
    } catch {
      window.location.href = `${CALENDAR_URL}?organization_id=${encodeURIComponent(org)}&_t=${Date.now()}`
    }
  }

  const sinResponsable = tree.find(r => r.responsable === 'Sin responsable')

  return (
    <div className="min-h-screen bg-slate-50/50 p-2 sm:p-4 lg:p-8 flex justify-center items-start font-sans w-full">
      <Toaster position="top-center" richColors />
      <Card className="w-full bg-gradient-to-b from-[#F5F8FD] to-white border border-slate-200 rounded-[20px] overflow-hidden p-3 sm:p-5 lg:p-8 relative animate__animated animate__fadeIn animate__faster">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-theme-from/5 rounded-full blur-[80px] animate-blob pointer-events-none z-0"></div>
        <div className="absolute top-0 left-0 right-0 h-15 bg-gradient-to-b from-theme-light to-transparent pointer-events-none z-0"></div>

        {/* ── ENCABEZADO ─────────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-5 lg:mb-6 gap-0 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-theme-from to-theme-to flex items-center justify-center shrink-0 shadow-sm border border-black/5 text-white">
              <Hourglass className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Trabajo en proceso (WIP)</h1>
                <ThemeMenu theme={theme} setTheme={setTheme} />
              </div>
              <p className="text-slate-500 text-sm mt-0.5">Tiempos, gastos y honorarios fijos por responsable, cliente y proyecto</p>
            </div>
          </div>
          <div className="flex gap-3 mt-4 lg:mt-0 w-full lg:w-auto">
            <Button variant="outline" type="button" onClick={() => load(true)} disabled={loading || !organizationId}
              className="flex-1 lg:flex-none h-11 sm:h-12 px-4 rounded-lg border-slate-200 text-slate-700 gap-2">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />Actualizar de Books
            </Button>
            <Button variant="outline" type="button" onClick={handleCancel}
              className="flex-1 lg:flex-none h-11 sm:h-12 px-6 rounded-lg border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-medium">
              Regresar
            </Button>
          </div>
        </div>

        {/* ── FILTROS ─────────────────────────────────────────────────────── */}
        <div className="relative z-10 border border-slate-200 rounded-xl bg-white p-3 sm:p-4 mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200" role="radiogroup" aria-label="Qué mostrar">
              {VISTAS.map(v => <button key={v.id} type="button" role="radio" aria-checked={filtros.vista === v.id} className={segCls(filtros.vista === v.id)} onClick={() => setFiltros(f => ({ ...f, vista: v.id }))}>{v.label}</button>)}
            </div>
            <div className="flex gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200" role="group" aria-label="Tipo">
              {TIPOS.map(t => {
                const on = !filtros.tipos.length || filtros.tipos.includes(t)
                return <button key={t} type="button" aria-pressed={on} className={segCls(on)} onClick={() => toggleTipo(t)}>{TIPO_PLURAL[t]}</button>
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(0,160px))_auto] gap-2 items-end">
            <label className="space-y-1"><span className={labelCls}>Desde</span>
              <Input type="date" className={inputCls} value={borrador.desde} onChange={e => setBorrador(b => ({ ...b, desde: e.target.value }))} /></label>
            <label className="space-y-1"><span className={labelCls}>Hasta</span>
              <Input type="date" className={inputCls} value={borrador.hasta} onChange={e => setBorrador(b => ({ ...b, hasta: e.target.value }))} /></label>
            <label className="space-y-1"><span className={labelCls}>Moneda</span>
              <select className={cn(inputCls, 'w-full px-2 border')} value={borrador.moneda} onChange={e => setBorrador(b => ({ ...b, moneda: e.target.value }))}>
                <option value="">Todas</option><option>MXN</option><option>USD</option><option>EUR</option>
              </select></label>
            <label className="space-y-1"><span className={labelCls}>Origen</span>
              <select className={cn(inputCls, 'w-full px-2 border')} value={borrador.origen} onChange={e => setBorrador(b => ({ ...b, origen: e.target.value as Filtros['origen'] }))}>
                <option value="">Aptus y Books</option><option value="aptus">Capturado en Aptus</option><option value="books">Histórico de Books</option>
              </select></label>
            <div className="col-span-2 sm:col-span-4 lg:col-span-1 flex gap-2">
              <Button type="button" className="h-9 flex-1 lg:flex-none" disabled={!pendientesDeAplicar || !!errorFechas || loading} onClick={aplicar}>Aplicar</Button>
              <Button type="button" variant="outline" className="h-9 border-slate-200" onClick={limpiar}>Limpiar</Button>
            </div>
          </div>
          {errorFechas && <p role="alert" className="text-xs text-red-700">{errorFechas}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_260px] gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input className={cn(inputCls, 'pl-8 pr-8')} placeholder="Buscar cliente, proyecto, abogado o descripción" value={texto} onChange={e => setTexto(e.target.value)} aria-label="Buscar" />
              {texto && <button type="button" aria-label="Borrar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setTexto('')}><X className="w-4 h-4" /></button>}
            </div>
            <select className={cn(inputCls, 'w-full px-2 border')} value={responsable} onChange={e => setResponsable(e.target.value)} aria-label="Responsable">
              <option value="">Todos los responsables</option>
              {responsables.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* ── CONTENIDO ───────────────────────────────────────────────────── */}
        <div className="relative z-10 space-y-4">
          {loadError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex flex-wrap items-center justify-between gap-2">
              {loadError}
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => load()}><RefreshCw className="w-3.5 h-3.5" />Reintentar</Button>
            </div>
          )}
          {loading && (
            <p className="text-sm text-slate-600 flex items-center gap-2" role="status">
              <Loader2 className="w-4 h-4 animate-spin text-theme-text" />
              {preparando ? `El servidor está preparando el reporte con los datos de Books (intento ${preparando}). Se vuelve a consultar solo…` : 'Cargando WIP…'}
            </p>
          )}

          {data && (
            <div className={cn("space-y-4 transition-opacity", loading && "opacity-50 pointer-events-none")} aria-busy={loading}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {totales.length ? totales.map(t => (
                  <div key={t.moneda} className="border border-slate-200 rounded-xl bg-white p-4">
                    <p className="text-[11px] font-semibold text-slate-500">Total {t.moneda}</p>
                    <p className="text-2xl font-bold text-slate-900 tabular-nums">{formatMoney(t.importe)}</p>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                      <div><dt className="text-slate-400">Tiempos</dt><dd className="tabular-nums">{formatMoney(t.importe_tiempo)}</dd></div>
                      <div><dt className="text-slate-400">Gastos</dt><dd className="tabular-nums">{formatMoney(t.importe_gastos)}</dd></div>
                      <div><dt className="text-slate-400">Fijos</dt><dd className="tabular-nums">{formatMoney(t.importe_fijos)}</dd></div>
                    </dl>
                    <p className="mt-2 text-[11px] text-slate-500">{t.renglones} registros · {formatHoras(t.horas)} h</p>
                  </div>
                )) : <p className="text-sm text-slate-500">No hay registros con estos filtros.</p>}
              </div>

              {!!tree.length && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500 flex items-center gap-1.5"><ListTree className="w-4 h-4" />{visibles.length} de {rows.length} registros · {tree.length} responsable(s)</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-8 border-slate-200" onClick={expandAll}>Expandir todo</Button>
                    <Button variant="outline" size="sm" className="h-8 border-slate-200" onClick={collapseAll}>Contraer todo</Button>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 border-slate-200" onClick={descargarCsv}><Download className="w-3.5 h-3.5" />CSV</Button>
                  </div>
                </div>
              )}

              {sinResponsable && (
                <p className="text-xs text-amber-800 rounded-lg border border-amber-200 bg-amber-50 p-2">
                  {sinResponsable.clientes.length} cliente(s) sin responsable de {data.rol_responsable === 'cobranza' ? 'cobranza' : 'facturación'}{' '}
                  (<Montos totales={sinResponsable.totales} className="inline-flex flex-row gap-2" />). Se asigna en{' '}
                  <a className="underline font-medium" href={`${PROJECT_CONFIG_URL}?organization_id=${encodeURIComponent(organizationId ?? '')}`}>Configuración del proyecto</a>.
                </p>
              )}

              {!!tree.length && <WipTree tree={tree} open={open} toggle={toggle} />}

              <p className="text-[11px] text-slate-500">
                Datos de Books {edadCache(data.cache?.edad_s)}{data.actualizando || data.cache?.actualizando ? ' (actualizándose en segundo plano)' : ''}.
                {' '}No se suman monedas distintas.
                {!!data.omitidos?.duplicados_respaldados && ` ${data.omitidos.duplicados_respaldados} tiempo(s) respaldados en Books se muestran una sola vez, con su tarifa real.`}
                {' '}El ícono <span className="text-amber-600">ⓘ</span> marca tiempos históricos de Books valuados con la tarifa plana del proyecto.
              </p>
            </div>
          )}
        </div>
        <p className="mt-4 text-[11px] text-slate-500 relative z-10">Solo consulta: desde aquí no se escribe en Aptus ni en Books.</p>
      </Card>

      <StatusModal
        isOpen={statusModal.isOpen}
        onClose={statusModal.type === 'error' && !organizationId ? undefined : () => setStatusModal(prev => ({ ...prev, isOpen: false }))}
        type={statusModal.type} title={statusModal.title} message={statusModal.message}
      />
    </div>
  )
}

export default App
