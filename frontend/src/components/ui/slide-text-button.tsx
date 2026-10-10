/**
 * @author: @dorianbaffier
 * @description: Slide Text Button
 * @version: 1.0.0
 * @date: 2025-06-26
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 */

import type { MouseEvent } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

type SlideTextButtonVariant = 'default' | 'ghost'

interface SlideTextButtonProps {
  text?: string
  hoverText?: string
  href?: string
  className?: string
  variant?: SlideTextButtonVariant
  onClick?: (event: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
}

const entrance = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: 'easeOut' as const },
}

export default function SlideTextButton({
  text = 'Button',
  hoverText = 'Click me',
  href,
  className,
  variant = 'default',
  onClick,
  type,
  disabled = false,
}: SlideTextButtonProps) {
  const classes = cn(
    'group relative inline-flex h-11 items-center justify-center overflow-hidden rounded-2xl px-6 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-50',
    variant === 'default' && '!bg-white !text-[#17211d] ring-1 ring-black/10',
    variant === 'ghost' &&
      'bg-transparent text-zinc-900 hover:bg-zinc-100 dark:text-white dark:hover:bg-zinc-800',
    disabled && 'pointer-events-none opacity-50',
    className,
  )

  const label = (
    <span className={cn('relative grid h-5 overflow-hidden', variant === 'default' && 'text-[#17211d]')}>
      <span className="col-start-1 row-start-1 block whitespace-nowrap transition-transform duration-300 ease-in-out group-hover:-translate-y-full">
        {text}
      </span>
      <span className="col-start-1 row-start-1 block translate-y-full whitespace-nowrap transition-transform duration-300 ease-in-out group-hover:translate-y-0">
        {hoverText}
      </span>
    </span>
  )

  if (type === 'submit' || !href) {
    return (
      <motion.button
        type={type === 'submit' ? 'submit' : 'button'}
        className={classes}
        onClick={onClick}
        disabled={disabled}
        {...entrance}
      >
        {label}
      </motion.button>
    )
  }

  return (
    <motion.a
      href={disabled ? undefined : href}
      className={classes}
      onClick={disabled ? (event) => event.preventDefault() : onClick}
      aria-disabled={disabled || undefined}
      {...entrance}
    >
      {label}
    </motion.a>
  )
}
