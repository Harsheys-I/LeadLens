import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils.ts'
import { THEME_CHANGE_EVENT } from '@/components/ui/switch-button.tsx'

export type FlickeringGridProps = {
  className?: string
  squareSize?: number
  gridGap?: number
  color?: string
  maxOpacity?: number
  flickerChance?: number
  height?: number
  width?: number
}

function colorToRgb(color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return [107, 114, 128]
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

function themeIsDark() {
  return document.documentElement.dataset.theme === 'dark'
}

export default function FlickeringGrid({
  className,
  squareSize = 4,
  gridGap = 6,
  color = '#6B7280',
  maxOpacity = 0.5,
  flickerChance = 0.1,
  height,
  width,
}: FlickeringGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    let cols = 0
    let rows = 0
    let squares = new Float32Array(0)
    let dpr = 1
    const inView = { current: true }
    let rgb = colorToRgb(color)

    const paintColor = () => {
      const [r, g, b] = rgb
      if (!themeIsDark()) return [r, g, b] as const
      const lift = (channel: number) => Math.round(channel + (255 - channel) * 0.38)
      return [lift(r), lift(g), lift(b)] as const
    }

    const setup = () => {
      const nextWidth = width || container.clientWidth
      const nextHeight = height || container.clientHeight
      dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(nextWidth * dpr))
      canvas.height = Math.max(1, Math.floor(nextHeight * dpr))
      canvas.style.width = `${nextWidth}px`
      canvas.style.height = `${nextHeight}px`
      cols = Math.max(1, Math.floor(nextWidth / (squareSize + gridGap)))
      rows = Math.max(1, Math.floor(nextHeight / (squareSize + gridGap)))
      squares = new Float32Array(cols * rows)
      for (let i = 0; i < squares.length; i++) squares[i] = Math.random() * maxOpacity
      rgb = colorToRgb(color)
    }

    setup()
    let last = 0
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw)
      if (!inView.current) return
      const delta = last ? (time - last) / 1000 : 0
      last = time
      for (let i = 0; i < squares.length; i++) {
        if (Math.random() < flickerChance * delta) squares[i] = Math.random() * maxOpacity
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const [r, g, b] = paintColor()
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const opacity = squares[i * rows + j] ?? 0
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`
          ctx.fillRect(
            i * (squareSize + gridGap) * dpr,
            j * (squareSize + gridGap) * dpr,
            squareSize * dpr,
            squareSize * dpr,
          )
        }
      }
    }
    frame = requestAnimationFrame(draw)

    const resize = new ResizeObserver(() => setup())
    resize.observe(container)
    const intersection = new IntersectionObserver(([entry]) => {
      inView.current = entry?.isIntersecting ?? true
    })
    intersection.observe(canvas)
    const onTheme = () => {
      rgb = colorToRgb(color)
    }
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)
    const themeNode = new MutationObserver(onTheme)
    themeNode.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      intersection.disconnect()
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
      themeNode.disconnect()
    }
  }, [squareSize, gridGap, color, maxOpacity, flickerChance, height, width])

  return (
    <div ref={containerRef} className={cn('h-full w-full', className)}>
      <canvas ref={canvasRef} className="pointer-events-none block" />
    </div>
  )
}
