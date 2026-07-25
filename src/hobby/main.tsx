import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HobbyApp } from './HobbyApp'
import { Top100BinderBoard } from './Top100BinderBoard'
import './hobby.css'

const top100 =
  new URLSearchParams(window.location.search).get('view') === 'top100'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {top100 ? <Top100BinderBoard /> : <HobbyApp />}
  </StrictMode>,
)
