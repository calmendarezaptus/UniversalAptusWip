import { ChevronRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ESTADO_LABEL, formatFecha, formatHoras, formatMoney, TIPO_LABEL, type Estado, type NodoResponsable, type Renglon, type Total } from '@/lib/wip'

const ESTADO_CLS: Record<Estado, string> = {
  sin_liberar: 'bg-slate-100 text-slate-700 border-slate-200',
  liberado: 'bg-sky-50 text-sky-800 border-sky-200',
  en_prebill: 'bg-violet-50 text-violet-800 border-violet-200',
  sin_facturar: 'bg-amber-50 text-amber-800 border-amber-200',
  facturado: 'bg-emerald-50 text-emerald-800 border-emerald-200',
}

// Importes por moneda, uno por línea (nunca se suman monedas distintas).
export function Montos({ totales, className }: { totales: Total[]; className?: string }) {
  if (!totales.length) return <span className={cn('text-slate-400', className)}>—</span>
  return (
    <span className={cn('flex flex-col items-end tabular-nums', className)}>
      {totales.map(t => <span key={t.moneda} className="whitespace-nowrap">{formatMoney(t.importe)} <span className="text-[10px] font-semibold text-slate-500">{t.moneda}</span></span>)}
    </span>
  )
}
const horasDe = (totales: Total[]) => totales.reduce((s, t) => s + t.horas, 0)
const renglonesDe = (totales: Total[]) => totales.reduce((s, t) => s + t.renglones, 0)

function Fila({ level, open, onToggle, title, totales, sub }: { level: 0 | 1 | 2; open: boolean; onToggle: () => void; title: string; totales: Total[]; sub?: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className={cn('w-full grid grid-cols-[1fr_auto] gap-3 items-center text-left px-3 py-2.5 hover:bg-theme-light/60 transition-colors',
        level === 0 && 'bg-slate-50 font-semibold text-slate-900', level === 1 && 'pl-7 text-slate-800', level === 2 && 'pl-11 text-slate-700 text-sm')}>
      <span className="flex items-center gap-2 min-w-0">
        <ChevronRight className={cn('w-4 h-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0">
          <span className="block truncate">{title}</span>
          <span className="block text-[11px] font-normal text-slate-500">{sub ?? `${renglonesDe(totales)} registros · ${formatHoras(horasDe(totales))} h`}</span>
        </span>
      </span>
      <Montos totales={totales} className="text-sm" />
    </button>
  )
}

function Renglones({ rows }: { rows: Renglon[] }) {
  return (
    <div className="pl-11 pr-3 pb-3 overflow-x-auto">
      <table className="w-full min-w-[760px] text-xs">
        <thead>
          <tr className="text-left text-[11px] text-slate-500 border-b border-slate-200">
            <th className="py-1.5 pr-2 font-medium">Fecha</th>
            <th className="py-1.5 pr-2 font-medium">Tipo</th>
            <th className="py-1.5 pr-2 font-medium">Abogado</th>
            <th className="py-1.5 pr-2 font-medium">Descripción</th>
            <th className="py-1.5 pr-2 font-medium text-right">Horas</th>
            <th className="py-1.5 pr-2 font-medium text-right">Tarifa</th>
            <th className="py-1.5 pr-2 font-medium text-right">Importe</th>
            <th className="py-1.5 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => (
            <tr key={r.id} className="align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{formatFecha(r.fecha)}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap">
                {TIPO_LABEL[r.tipo] ?? r.tipo}
                <span className={cn('ml-1 text-[10px] font-semibold rounded px-1 py-0.5 border', r.origen === 'aptus' ? 'bg-theme-light text-theme-text border-theme-border' : 'bg-slate-50 text-slate-500 border-slate-200')}>{r.origen === 'aptus' ? 'Aptus' : 'Books'}</span>
              </td>
              <td className="py-1.5 pr-2">{r.abogado || <span className="text-slate-400">—</span>}</td>
              <td className="py-1.5 pr-2 max-w-[320px]">
                {r.tarea && <span className="block text-[11px] text-slate-500">{r.tarea}</span>}
                <span className="block break-words">{r.descripcion || <span className="text-slate-400">—</span>}</span>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{r.tipo === 'tiempo' ? formatHoras(r.horas) : ''}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">
                {r.tarifa != null ? formatMoney(r.tarifa) : ''}
                {r.tarifa_referencia && <span title="Tiempo histórico de Books: el importe usa la tarifa plana del proyecto como referencia." className="ml-1 inline-flex align-middle text-amber-600"><Info className="w-3 h-3" /></span>}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap font-medium">{formatMoney(r.importe)} <span className="text-[10px] text-slate-500">{r.moneda}</span></td>
              <td className="py-1.5 whitespace-nowrap">
                <span className={cn('text-[10px] font-semibold rounded px-1.5 py-0.5 border', ESTADO_CLS[r.estado] ?? ESTADO_CLS.sin_liberar)}>{ESTADO_LABEL[r.estado] ?? r.estado}</span>
                {r.prebill && <span className="block mt-0.5 text-[10px] text-slate-500">Prebill #{r.prebill.id}{r.prebill.factura ? ` · ${r.prebill.factura}` : ''}</span>}
                {!r.prebill && r.zoho_invoice_number && <span className="block mt-0.5 text-[10px] text-slate-500">{r.zoho_invoice_number}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WipTree({ tree, open, toggle }: { tree: NodoResponsable[]; open: Set<string>; toggle: (key: string) => void }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white divide-y divide-slate-200">
      {tree.map(r => (
        <div key={r.key}>
          <Fila level={0} open={open.has(r.key)} onToggle={() => toggle(r.key)} title={r.responsable} totales={r.totales}
            sub={`${r.clientes.length} cliente(s) · ${renglonesDe(r.totales)} registros · ${formatHoras(horasDe(r.totales))} h`} />
          {open.has(r.key) && (
            <div className="divide-y divide-slate-100">
              {r.clientes.map(c => (
                <div key={c.key}>
                  <Fila level={1} open={open.has(c.key)} onToggle={() => toggle(c.key)} title={c.cliente} totales={c.totales} />
                  {open.has(c.key) && c.proyectos.map(p => (
                    <div key={p.key}>
                      <Fila level={2} open={open.has(p.key)} onToggle={() => toggle(p.key)} title={p.proyecto} totales={p.totales} />
                      {open.has(p.key) && <Renglones rows={p.renglones} />}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
