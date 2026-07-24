import { Component, type ErrorInfo, type ReactNode } from 'react'

interface LazyChartBoundaryProps {
  children: ReactNode
  fallback: ReactNode
}

interface LazyChartBoundaryState {
  failed: boolean
}

export class LazyChartBoundary extends Component<
  LazyChartBoundaryProps,
  LazyChartBoundaryState
> {
  state: LazyChartBoundaryState = { failed: false }

  static getDerivedStateFromError(): LazyChartBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.warn('A lazy-loaded chart could not be rendered.', error, info)
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
