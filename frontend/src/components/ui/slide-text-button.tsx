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
import { motion, type Variants } from 'motion/react'
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

const textVariants: Variants = {
  initial: { y: '0%' },
  hover: { y: '-100%' },
}

const hoverTextVariants: Variants = {
  initial: { y: '100%' },
  hover: { y: '0%' },
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
    variant === 'default' && 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900',
    variant === 'ghost' &&
      'bg-transparent text-zinc-900 hover:bg-zinc-100 dark:text-white dark:hover:bg-zinc-800',
    disabled && 'pointer-events-none opacity-50',
    className,
  )

  const label = (
    <span className="relative block h-5 overflow-hidden">
      <motion.span
        className="block"
        variants={textVariants}
        initial="initial"
        transition={{ duration: 0.28, ease: 'easeInOut' }}
      >
        {text}
      </motion.span>
      <motion.span
        className="absolute inset-0 block"
        variants={hoverTextVariants}
        initial="initial"
        transition={{ duration: 0.28, ease: 'easeInOut' }}
      >
        {hoverText}
      </motion.span>
    </span>
  )

  if (type === 'submit' || !href) {
    return (
      <motion.button
        type="submit"
        className={classes}
        onClick={onClick}
        disabled={disabled}
        whileHover={disabled ? undefined : 'hover'}
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
      whileHover={disabled ? undefined : 'hover'}
      {...entrance}
    >
      {label}
    </motion.a>
  )
}
