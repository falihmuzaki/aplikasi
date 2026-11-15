const configuredStorefrontUrl = import.meta.env.VITE_STOREFRONT_URL

export const STOREFRONT_URL = (configuredStorefrontUrl || (import.meta.env.DEV ? 'http://localhost:5174' : '/')).replace(/\/+$/, '') || '/'
