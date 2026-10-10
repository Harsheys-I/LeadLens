import { useRef, type RefObject } from 'react'
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react'
import { cn } from '@/lib/utils.ts'

const SPRING = { stiffness: 180, damping: 16, mass: 0.35 }

function useReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function KineticText({ text, className }: { text: string; className?: string }) {
  const parent = useRef<HTMLDivElement>(null)
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY)
  const mouseY = useMotionValue(Number.POSITIVE_INFINITY)
  const reduce = useReducedMotion()

  if (reduce) {
    return <div className={cn('select-none', className)}>{text}</div>
  }

  return (
    <div
      ref={parent}
      className={cn('flex cursor-default select-none', className)}
      onMouseMove={(event) => {
        const box = parent.current?.getBoundingClientRect()
        if (!box) return
        mouseX.set(event.clientX - box.left)
        mouseY.set(event.clientY - box.top)
      }}
      onMouseLeave={() => {
        mouseX.set(Number.POSITIVE_INFINITY)
        mouseY.set(Number.POSITIVE_INFINITY)
      }}
    >
      {Array.from(text).map((char, index) => (
        <KineticChar
          key={`${char}-${index}`}
          char={char}
          mouseX={mouseX}
          mouseY={mouseY}
          parent={parent}
        />
      ))}
    </div>
  )
}

function KineticChar({
  char,
  mouseX,
  mouseY,
  parent,
}: {
  char: string
  mouseX: MotionValue<number>
  mouseY: MotionValue<number>
  parent: RefObject<HTMLDivElement | null>
}) {
  const letter = useRef<HTMLSpanElement>(null)
  const offset = useTransform([mouseX, mouseY], ([x, y]) => {
    const el = letter.current
    const box = parent.current
    const px = Number(x)
    const py = Number(y)
    if (!el || !box || !Number.isFinite(px) || !Number.isFinite(py)) return { x: 0, y: 0, rotate: 0 }
    const rect = el.getBoundingClientRect()
    const parentRect = box.getBoundingClientRect()
    const cx = rect.left - parentRect.left + rect.width / 2
    const cy = rect.top - parentRect.top + rect.height / 2
    const dx = px - cx
    const dy = py - cy
    const dist = Math.hypot(dx, dy) || 1
    const radius = 140
    if (dist > radius) return { x: 0, y: 0, rotate: 0 }
    const pull = (1 - dist / radius) * 14
    return { x: (dx / dist) * pull, y: (dy / dist) * pull, rotate: (dx / dist) * 8 * (1 - dist / radius) }
  })
  const x = useSpring(useTransform(offset, (value) => value.x), SPRING)
  const y = useSpring(useTransform(offset, (value) => value.y), SPRING)
  const rotate = useSpring(useTransform(offset, (value) => value.rotate), SPRING)

  return (
    <motion.span ref={letter} className="inline-block whitespace-pre" style={{ x, y, rotate }}>
      {char === ' ' ? '\u00A0' : char}
    </motion.span>
  )
}
