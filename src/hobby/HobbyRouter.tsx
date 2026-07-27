import { lazy, Suspense } from 'react'

const HobbyApp = lazy(async () => {
  const module = await import('./HobbyApp')
  return { default: module.HobbyApp }
})
const Top100BinderBoard = lazy(async () => {
  const module = await import('./Top100BinderBoard')
  return { default: module.Top100BinderBoard }
})
const Under25BinderBoard = lazy(async () => {
  const module = await import('./Under25BinderBoard')
  return { default: module.Under25BinderBoard }
})
const ExitWindowBoard = lazy(async () => {
  const module = await import('./ExitWindowBoard')
  return { default: module.ExitWindowBoard }
})

export function HobbyRouter() {
  const view = new URLSearchParams(window.location.search).get('view')
  return (
    <Suspense
      fallback={(
        <div className="mx-route-loading" role="status">
          Opening the Binder Index…
        </div>
      )}
    >
      {view === 'top100'
        ? <Top100BinderBoard />
        : view === 'under25'
          ? <Under25BinderBoard />
          : view === 'exit100'
            ? <ExitWindowBoard />
            : <HobbyApp />}
    </Suspense>
  )
}
