const configuredCmsUrl = import.meta.env.VITE_CMS_URL

export const CMS_URL = (configuredCmsUrl || (import.meta.env.DEV ? 'http://localhost:5173' : '/')).replace(/\/+$/, '') || '/'
