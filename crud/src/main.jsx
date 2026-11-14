import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Storefront from './Storefront.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('shop') === '1' ? <Storefront /> : <App />}
  </StrictMode>,
)
