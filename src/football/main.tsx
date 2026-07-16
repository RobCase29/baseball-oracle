import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FootballOracle } from './FootballOracle'
import './football.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FootballOracle />
  </StrictMode>,
)
