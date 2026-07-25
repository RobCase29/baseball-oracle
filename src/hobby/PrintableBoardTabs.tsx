export type PrintableBoardView = 'top100' | 'under25' | 'exit100'

export interface PrintableBoardTabsProps {
  current: PrintableBoardView
}

const boards: ReadonlyArray<{
  view: PrintableBoardView
  label: string
}> = [
  { view: 'top100', label: 'Top 100' },
  { view: 'under25', label: '25 Under 25' },
  { view: 'exit100', label: 'Exit 100' },
]

export function PrintableBoardTabs({
  current,
}: PrintableBoardTabsProps) {
  return (
    <nav
      className="bbi-top100__board-tabs"
      aria-label="Printable Binder Index boards"
    >
      {boards.map((board) => (
        <a
          aria-current={current === board.view ? 'page' : undefined}
          href={`/hobby?view=${board.view}`}
          key={board.view}
        >
          {board.label}
        </a>
      ))}
    </nav>
  )
}
