import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

export type MorphicNavItem = {
  id: string
  name: string
  href?: string
}

export type MorphicNavbarProps = {
  items: MorphicNavItem[] | Record<string, Omit<MorphicNavItem, 'id'>>
  activeId?: string
  onChange?: (id: string) => void
  className?: string
}

function toItems(items: MorphicNavbarProps['items']): MorphicNavItem[] {
  if (Array.isArray(items)) return items
  return Object.entries(items).map(([id, value]) => ({
    id,
    name: value.name,
    href: value.href,
  }))
}

export function MorphicNavbar({ items, activeId, onChange, className }: MorphicNavbarProps) {
  const list = useMemo(() => toItems(items), [items])
  const layoutId = useId()
  const scrollerRef = useRef<HTMLElement>(null)
  const [uncontrolledId, setUncontrolledId] = useState(() => activeId ?? list[0]?.id ?? '')
  const currentId = activeId ?? uncontrolledId
  const activeIndex = list.findIndex((item) => item.id === currentId)

  useEffect(() => {
    const active = scrollerRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [currentId])

  const select = (id: string) => {
    if (activeId === undefined) setUncontrolledId(id)
    onChange?.(id)
  }

  return (
    <nav
      ref={scrollerRef}
      aria-label="Sections"
      className={cn(
        'glass flex w-full max-w-full items-stretch overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {list.map((item, index) => {
        const isActive = item.id === currentId
        const classNameForItem = cn(
          'relative z-10 inline-flex shrink-0 items-center whitespace-nowrap px-4 py-2 text-sm font-medium transition-[color,border-radius,margin] duration-300',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'mx-1 text-foreground'
            : 'text-zinc-600 hover:text-foreground dark:text-zinc-400',
          index === activeIndex - 1 && 'rounded-r-[1.35rem]',
          index === activeIndex + 1 && 'rounded-l-[1.35rem]',
        )

        const label = (
          <>
            {isActive ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-full bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
              />
            ) : null}
            {item.name}
          </>
        )

        if (item.href) {
          return (
            <a
              key={item.id}
              href={item.href}
              data-active={isActive ? 'true' : undefined}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => select(item.id)}
              className={classNameForItem}
            >
              {label}
            </a>
          )
        }

        return (
          <button
            key={item.id}
            type="button"
            data-active={isActive ? 'true' : undefined}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => select(item.id)}
            className={classNameForItem}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}
