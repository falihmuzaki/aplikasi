const configuredApiUrl = import.meta.env.VITE_API_URL
const defaultApiUrl = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api'

export const API_URL = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, '')
