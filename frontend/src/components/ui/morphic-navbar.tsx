import { cn } from '@/lib/utils.ts'

export type MorphicNavItem = {
  key: string
  href: string
  name: string
}

export default function MorphicNavbar({
  items,
  activeKey,
  onNavigate,
  className,
}: {
  items: MorphicNavItem[]
  activeKey: string
  onNavigate?: (key: string) => void
  className?: string
}) {
  return (
    <nav className={cn('flex max-w-full justify-center overflow-x-auto', className)} aria-label="Modules">
      <div className="glass flex items-center justify-between overflow-hidden rounded-xl">
        {items.map((item, index, array) => {
          const isActive = item.key === activeKey
          const isFirst = index === 0
          const isLast = index === array.length - 1
          const prevActive = index > 0 && array[index - 1].key === activeKey
          const nextActive = index < array.length - 1 && array[index + 1].key === activeKey
          return (
            <a
              key={item.key}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center justify-center bg-black p-1.5 px-4 text-sm text-white transition-all duration-300 dark:bg-white dark:text-black',
                isActive
                  ? 'mx-2 rounded-xl font-semibold'
                  : cn(
                    (prevActive || isFirst) && 'rounded-l-xl',
                    (nextActive || isLast) && 'rounded-r-xl',
                  ),
              )}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
                event.preventDefault()
                onNavigate?.(item.key)
              }}
            >
              {item.name}
            </a>
          )
        })}
      </div>
    </nav>
  )
}
