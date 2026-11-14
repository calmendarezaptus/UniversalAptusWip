// Función del proyecto Reportes (ReportsForAptusFinancials): aptus_report_services.
// Desarrollo usa el proxy de Vite (mismo origen); VITE_API_BASE_URL la reemplaza si se define.
const FALLBACK_API = 'https://reportsforaptusfinancials-730085095.development.catalystserverless.com/server/aptus_report_services'
export const API_BASE = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_BASE_URL || FALLBACK_API).replace(/\/$/, '')

// A dónde regresa "Regresar" si no llega ?origin= (calendario consolidado).
export const CALENDAR_URL = import.meta.env.VITE_CALENDAR_URL || 'https://universal-aptus-calendar.onslate.com/'

// Configuración del proyecto (asignar responsables a lo que sale "Sin responsable").
export const PROJECT_CONFIG_URL = import.meta.env.VITE_PROJECT_CONFIG_URL || 'https://universal-aptus-projectconfig.onslate.com/'
