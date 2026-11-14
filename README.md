# Trabajo en proceso (WIP)

Slate del proyecto Reportes (`ReportsForAptusFinancials`). Muestra el WIP de ReportesSandbox por
responsable → cliente → proyecto, con totales por moneda. **Solo consulta.**

- Abre con `?organization_id=<org de Books>`; opcional `?origin=` para el botón Regresar.
- Filtros que van a la API: Pendiente / Facturado / Todo, tipo, fechas, moneda y origen. Búsqueda y
  responsable se filtran en pantalla. "Actualizar de Books" pide `forzar=1`.
- Si el servidor todavía prepara la copia (`{ listo: false }`), vuelve a consultar cada 4 s.
- Descarga CSV de lo que se ve.

Variables (opcionales): `VITE_API_BASE_URL` (URL de `aptus_report_services`), `VITE_CALENDAR_URL`,
`VITE_PROJECT_CONFIG_URL`.

```bash
npm install
npm test        # lógica de agrupación, filtros, CSV y lectura
npm run build   # salida en dist/
```
