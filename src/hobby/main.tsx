import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ExitWindowBoard } from './ExitWindowBoard'
import { HobbyApp } from './HobbyApp'
import { Top100BinderBoard } from './Top100BinderBoard'
import { Under25BinderBoard } from './Under25BinderBoard'
import './hobby.css'

const view = new URLSearchParams(window.location.search).get('view')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'top100'
      ? <Top100BinderBoard />
      : view === 'under25'
        ? <Under25BinderBoard />
        : view === 'exit100'
          ? <ExitWindowBoard />
          : <HobbyApp />}
  </StrictMode>,
)
