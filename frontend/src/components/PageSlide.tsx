import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

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

function SlidePage({
  viewKey,
  direction,
  onMeasure,
  children,
}: {
  viewKey: string
  direction: number
  onMeasure: (key: string, value: number | null) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const measure = () => onMeasure(viewKey, node.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
      onMeasure(viewKey, null)
    }
  }, [viewKey, onMeasure])

  return (
    <motion.div
      ref={ref}
      custom={direction}
      variants={slideVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={transition}
      className="absolute inset-x-0 top-0 flex w-full flex-col gap-6 px-4 pb-16"
    >
      {children}
    </motion.div>
  )
}

export default function PageSlide({ viewKey, direction, children }: { viewKey: string; direction: number; children: ReactNode }) {
  const heights = useRef(new Map<string, number>())
  const [height, setHeight] = useState(0)
  const onMeasure = useCallback((key: string, value: number | null) => {
    if (value == null) heights.current.delete(key)
    else heights.current.set(key, value)
    const vals = [...heights.current.values()]
    setHeight(vals.length ? Math.max(...vals) : 0)
  }, [])

  return (
    <div className="relative mx-auto max-w-6xl overflow-hidden" style={{ height: height || undefined }}>
      <AnimatePresence initial={false} custom={direction}>
        <SlidePage key={viewKey} viewKey={viewKey} direction={direction} onMeasure={onMeasure}>
          {children}
        </SlidePage>
      </AnimatePresence>
    </div>
  )
}
