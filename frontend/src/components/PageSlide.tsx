import { type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/utils'

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
    filter: 'blur(8px)',
    scale: 0.95,
  }),
  center: { x: 0, opacity: 1, filter: 'blur(0px)', scale: 1 },
  exit: (direction: number) => ({
    x: direction < 0 ? '100%' : '-100%',
    opacity: 0,
    filter: 'blur(8px)',
    scale: 0.95,
  }),
}

const transition = { duration: 0.4, ease: [0.32, 0.72, 0, 1] as const }

export default function PageSlide({
  viewKey,
  direction,
  className,
  children,
}: {
  viewKey: string
  direction: number
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full max-w-6xl overflow-visible', className)}>
      <AnimatePresence initial={false} custom={direction} mode="wait">
        <motion.div
          key={viewKey}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition}
          className="relative flex w-full flex-col gap-6 overflow-visible px-4 pb-24"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
