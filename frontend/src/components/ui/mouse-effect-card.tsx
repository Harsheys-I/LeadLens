/**
 * @author: @dorianbaffier
 * @description: Mouse Effect Card - Interactive card with animated dot pattern that responds to mouse movement
 * @version: 1.0.0
 * @date: 2025-01-30
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 */

import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const SPRING_CONFIG = { stiffness: 300, damping: 30, mass: 0.5 }
const OPACITY_DURATION_BASE = 0.8
const OPACITY_DURATION_VARIATION = 0.2
const OPACITY_EASE = [0.4, 0, 0.2, 1] as const
const OPACITY_DELAY_CYCLE = 1.5
const OPACITY_DELAY_STEP = 0.02
const MIN_OPACITY_MULTIPLIER = 0.5
const MAX_OPACITY_MULTIPLIER = 1.5
const MIN_OPACITY_FALLBACK = 0.3
const PROXIMITY_MULTIPLIER = 1.2
const PROXIMITY_OPACITY_BOOST = 0.8

export interface MouseEffectCardProps {
  className?: string
  children?: ReactNode
  dotSize?: number
  dotSpacing?: number
  repulsionRadius?: number
  repulsionStrength?: number
  title?: string
  subtitle?: string
  topText?: string
  topSubtext?: string
  primaryCtaText?: string
  primaryCtaUrl?: string
  onPrimaryCtaClick?: (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void
  secondaryCtaText?: string
  secondaryCtaUrl?: string
  onSecondaryCtaClick?: (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void
  footerText?: string
  ariaLabel?: string
}

interface Dot {
  id: string
  x: number
  y: number
  baseX: number
  baseY: number
  opacity: number
}

interface DotComponentProps {
  dot: Dot
  index: number
  dotSize: number
  mouseX: MotionValue<number>
  mouseY: MotionValue<number>
  repulsionRadius: number
  repulsionStrength: number
}

function calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2
  const dy = y1 - y2
  return Math.sqrt(dx * dx + dy * dy)
}

function generateDots(width: number, height: number, spacing: number): Dot[] {
  const dots: Dot[] = []
  const cols = Math.ceil(width / spacing)
  const rows = Math.ceil(height / spacing)
  const centerX = width / 2
  const centerY = height / 2
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY)

  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const x = col * spacing
      const y = row * spacing

      const dx = x - centerX
      const dy = y - centerY
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy)

      const edgeFactor = Math.min(distanceFromCenter / (maxDistance * 0.7), 1)

      if (Math.random() > edgeFactor) {
        continue
      }

      const pattern = (row + col) % 3
      const baseOpacities = [0.3, 0.5, 0.7]
      const opacity = baseOpacities[pattern] * edgeFactor

      dots.push({
        id: `dot-${row}-${col}`,
        x,
        y,
        baseX: x,
        baseY: y,
        opacity,
      })
    }
  }

  return dots
}

function DotComponent({
  dot,
  index,
  dotSize,
  mouseX,
  mouseY,
  repulsionRadius,
  repulsionStrength,
}: DotComponentProps) {
  const posX = useTransform([mouseX, mouseY], () => {
    const mx = mouseX.get()
    const my = mouseY.get()

    if (!(Number.isFinite(mx) && Number.isFinite(my))) {
      return 0
    }

    const dx = dot.baseX - mx
    const dy = dot.baseY - my
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance < repulsionRadius) {
      const force = (1 - distance / repulsionRadius) * repulsionStrength
      const angle = Math.atan2(dy, dx)
      return Math.cos(angle) * force
    }

    return 0
  })

  const posY = useTransform([mouseX, mouseY], () => {
    const mx = mouseX.get()
    const my = mouseY.get()

    if (!(Number.isFinite(mx) && Number.isFinite(my))) {
      return 0
    }

    const dx = dot.baseX - mx
    const dy = dot.baseY - my
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance < repulsionRadius) {
      const force = (1 - distance / repulsionRadius) * repulsionStrength
      const angle = Math.atan2(dy, dx)
      return Math.sin(angle) * force
    }

    return 0
  })

  const opacityBoost = useTransform([mouseX, mouseY], () => {
    const mx = mouseX.get()
    const my = mouseY.get()

    if (!(Number.isFinite(mx) && Number.isFinite(my))) return 0

    const distance = calculateDistance(dot.baseX, dot.baseY, mx, my)
    const maxDistance = repulsionRadius * PROXIMITY_MULTIPLIER

    if (distance < maxDistance) {
      const proximityFactor = 1 - distance / maxDistance
      return proximityFactor * PROXIMITY_OPACITY_BOOST
    }

    return 0
  })

  const x = useSpring(posX, SPRING_CONFIG)
  const y = useSpring(posY, SPRING_CONFIG)

  const baseMinOpacity = Math.max(dot.opacity * MIN_OPACITY_MULTIPLIER, MIN_OPACITY_FALLBACK)
  const baseMaxOpacity = Math.min(dot.opacity * MAX_OPACITY_MULTIPLIER, 1)

  const minOpacityWithBoost = useTransform(opacityBoost, (boost) => Math.min(baseMinOpacity + boost, 1))
  const boostedOpacity = useSpring(minOpacityWithBoost, {
    stiffness: 150,
    damping: 25,
  })

  const delay = (index * OPACITY_DELAY_STEP) % OPACITY_DELAY_CYCLE

  return (
    <motion.div
      animate={{
        opacity: [baseMinOpacity, baseMaxOpacity, baseMinOpacity],
      }}
      className="absolute rounded-full bg-zinc-400 will-change-transform dark:bg-zinc-600"
      initial={{ opacity: baseMinOpacity }}
      style={{
        width: dotSize,
        height: dotSize,
        left: dot.baseX,
        top: dot.baseY,
        x,
        y,
        opacity: boostedOpacity,
      }}
      transition={{
        opacity: {
          duration: OPACITY_DURATION_BASE + (index % 4) * OPACITY_DURATION_VARIATION,
          repeat: Number.POSITIVE_INFINITY,
          ease: OPACITY_EASE,
          delay,
          times: [0, 0.5, 1],
        },
      }}
    />
  )
}

function isNavigableUrl(url?: string) {
  return Boolean(url && url !== '#')
}

function CardCta({
  text,
  url,
  onClick,
  className,
  variant,
}: {
  text?: string
  url?: string
  onClick?: (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void
  className?: string
  variant?: ButtonProps['variant']
}) {
  if (!text) return null

  if (!isNavigableUrl(url)) {
    return (
      <Button className={className} onClick={onClick} size="lg" type="button" variant={variant}>
        {text}
      </Button>
    )
  }

  return (
    <Button asChild className={className} size="lg" variant={variant}>
      <a
        href={url}
        onClick={(event) => {
          onClick?.(event)
        }}
      >
        {text}
      </a>
    </Button>
  )
}

export default function MouseEffectCard({
  className,
  children,
  dotSize = 2,
  dotSpacing = 16,
  repulsionRadius = 80,
  repulsionStrength = 20,
  title = '',
  subtitle = '',
  topText = '',
  topSubtext = '',
  primaryCtaText = '',
  primaryCtaUrl = '#',
  onPrimaryCtaClick,
  secondaryCtaText = '',
  secondaryCtaUrl = '#',
  onSecondaryCtaClick,
  footerText = '',
  ariaLabel,
}: MouseEffectCardProps) {
  const innerContainerRef = useRef<HTMLDivElement>(null)
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY)
  const mouseY = useMotionValue(Number.POSITIVE_INFINITY)
  const [dots, setDots] = useState<Dot[]>([])

  useEffect(() => {
    const updateDots = () => {
      if (!innerContainerRef.current) return
      const rect = innerContainerRef.current.getBoundingClientRect()
      const newDots = generateDots(rect.width, rect.height, dotSpacing)
      setDots(newDots)
    }

    updateDots()

    const resizeObserver = new ResizeObserver(updateDots)
    if (innerContainerRef.current) {
      resizeObserver.observe(innerContainerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [dotSpacing])

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!innerContainerRef.current) return

    const rect = innerContainerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    mouseX.set(x)
    mouseY.set(y)
  }

  const handleMouseLeave = () => {
    mouseX.set(Number.POSITIVE_INFINITY)
    mouseY.set(Number.POSITIVE_INFINITY)
  }

  const handleFocus = () => {
    if (!innerContainerRef.current) return
    const rect = innerContainerRef.current.getBoundingClientRect()
    mouseX.set(rect.width / 2)
    mouseY.set(rect.height / 2)
  }

  const handleBlur = () => {
    mouseX.set(Number.POSITIVE_INFINITY)
    mouseY.set(Number.POSITIVE_INFINITY)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!innerContainerRef.current) return
    const rect = innerContainerRef.current.getBoundingClientRect()
    const step = Math.min(rect.width, rect.height) * 0.2
    const currentX = Number.isFinite(mouseX.get()) ? mouseX.get() : rect.width / 2
    const currentY = Number.isFinite(mouseY.get()) ? mouseY.get() : rect.height / 2

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        mouseY.set(Math.max(0, currentY - step))
        mouseX.set(currentX)
        break
      case 'ArrowDown':
        e.preventDefault()
        mouseY.set(Math.min(rect.height, currentY + step))
        mouseX.set(currentX)
        break
      case 'ArrowLeft':
        e.preventDefault()
        mouseX.set(Math.max(0, currentX - step))
        mouseY.set(currentY)
        break
      case 'ArrowRight':
        e.preventDefault()
        mouseX.set(Math.min(rect.width, currentX + step))
        mouseY.set(currentY)
        break
    }
  }

  return (
    <Card
      className={cn(
        'relative w-full max-w-md overflow-hidden rounded-2xl border border-white/40 p-0 shadow-none dark:border-white/10',
        className,
      )}
    >
      <CardContent className="relative h-[400px] w-full overflow-hidden p-0">
        <div
          aria-label={ariaLabel ?? `${title} — ${subtitle}`}
          className="relative h-full w-full"
          onBlur={handleBlur}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
          ref={innerContainerRef}
          tabIndex={0}
        >
          {dots.map((dot, index) => (
            <DotComponent
              dot={dot}
              dotSize={dotSize}
              index={index}
              key={dot.id}
              mouseX={mouseX}
              mouseY={mouseY}
              repulsionRadius={repulsionRadius}
              repulsionStrength={repulsionStrength}
            />
          ))}

          {topText ? (
            <div className="absolute top-6 left-6 z-10">
              <div className="relative">
                <div className="absolute inset-0 rounded-lg bg-white/60 blur-lg dark:bg-zinc-950/60" />
                <div className="relative flex flex-col gap-1">
                  <p className="font-bold text-sm text-zinc-900 dark:text-white">{topText}</p>
                  {topSubtext ? (
                    <p className="font-medium text-xs text-zinc-600 opacity-70 dark:text-zinc-400">{topSubtext}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="relative z-10 flex h-full flex-col items-center justify-center px-2">
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-white/80 blur-2xl dark:bg-zinc-950/80" />
                <h2 className="relative text-center font-bold text-4xl text-zinc-900 tracking-tight dark:text-white">
                  {title}
                </h2>
              </div>
              {subtitle ? (
                <div className="relative">
                  <div className="absolute inset-0 rounded-lg bg-white/60 blur-xl dark:bg-zinc-950/60" />
                  <div className="relative max-w-sm text-center font-medium text-base text-zinc-700 leading-relaxed dark:text-zinc-300">
                    {subtitle}
                  </div>
                </div>
              ) : null}
              {children}
              <div className="mt-2 flex items-center gap-3">
                <CardCta
                  className="rounded-full shadow-lg"
                  onClick={onPrimaryCtaClick}
                  text={primaryCtaText}
                  url={primaryCtaUrl}
                />
                <CardCta
                  className="rounded-full"
                  onClick={onSecondaryCtaClick}
                  text={secondaryCtaText}
                  url={secondaryCtaUrl}
                  variant="outline"
                />
              </div>
            </div>
          </div>

          {footerText ? (
            <div className="absolute right-0 bottom-6 left-0 z-10 flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-white/60 blur-lg dark:bg-zinc-950/60" />
                <p className="relative px-4 py-1 font-medium text-xs text-zinc-600 dark:text-zinc-400">{footerText}</p>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export { MouseEffectCard }
