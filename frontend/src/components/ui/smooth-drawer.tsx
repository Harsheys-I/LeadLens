import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button.tsx'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer.tsx'
import { assetUrl } from '@/lib/paths.ts'

interface PriceTagProps {
  price: number
  discountedPrice: number
}

export function PriceTag({ price, discountedPrice }: PriceTagProps) {
  return (
    <div className="mx-auto flex max-w-fit items-center justify-around gap-4">
      <div className="flex items-baseline gap-2">
        <span className="bg-gradient-to-br from-zinc-900 to-zinc-700 bg-clip-text font-bold text-4xl text-transparent dark:from-white dark:to-zinc-300">
          ${discountedPrice}
        </span>
        <span className="text-lg text-zinc-400 line-through dark:text-zinc-500">${price}</span>
      </div>
    </div>
  )
}

const drawerVariants = {
  hidden: {
    y: '100%',
    opacity: 0,
    rotateX: 5,
    transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
  },
  visible: {
    y: 0,
    opacity: 1,
    rotateX: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 30,
      mass: 0.8,
      staggerChildren: 0.07,
      delayChildren: 0.2,
    },
  },
}

const itemVariants = {
  hidden: {
    y: 20,
    opacity: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
  },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 30, mass: 0.8 },
  },
}

export type Notice = {
  id: number
  title?: string
  body?: string
  created_at?: string
  is_read?: number | boolean
  read?: boolean
}

export default function SmoothDrawer({
  open,
  onClose,
  unread = 0,
  notes = [],
  onRead,
  onMarkAll,
  onClearAll,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  unread?: number
  notes?: Notice[]
  onRead?: (id: number) => void
  onMarkAll?: () => void
  onClearAll?: () => void
  title?: string
  description?: string
  children?: ReactNode
}) {
  const custom = children != null
  return (
    <Drawer open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DrawerContent className="mx-auto max-h-[88vh] max-w-lg rounded-t-2xl p-6 shadow-xl">
        <motion.div
          animate="visible"
          className="mx-auto w-full max-w-lg space-y-4"
          initial="hidden"
          variants={drawerVariants}
        >
          <motion.div variants={itemVariants}>
            <DrawerHeader className="space-y-2.5 px-0">
              <DrawerTitle className="flex items-center gap-2.5 font-semibold text-2xl tracking-tighter">
                {custom ? null : (
                  <span className="rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 p-1.5 shadow-inner dark:from-zinc-800 dark:to-zinc-900">
                    <img alt="" height={32} width={48} src={assetUrl('assets/gpp-ai-logo.png')} className="h-8 w-12 object-contain" />
                  </span>
                )}
                <span>{custom ? (title || 'New user') : 'Notifications'}</span>
              </DrawerTitle>
              <DrawerDescription className="text-sm text-zinc-600 dark:text-zinc-400">
                {custom ? (description || 'Create a user account') : `${unread} unread`}
              </DrawerDescription>
            </DrawerHeader>
          </motion.div>

          {custom ? <motion.div variants={itemVariants}>{children}</motion.div> : (
          <motion.ul variants={itemVariants} className="max-h-[40vh] space-y-2 overflow-y-auto">
            {notes.length === 0 ? <li className="py-6 text-center text-sm text-zinc-500">No notifications</li> : null}
            {notes.map((note) => {
              const unreadRow = note.read === false || note.is_read === 0 || note.is_read === false
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    className={`w-full rounded-xl border px-3 py-3 text-left ${unreadRow ? 'border-teal-200 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/40' : 'border-zinc-200 dark:border-zinc-800'}`}
                    onClick={() => onRead?.(note.id)}
                  >
                    <strong className="block text-sm">{note.title || 'Notification'}</strong>
                    {note.body ? <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-300">{note.body}</span> : null}
                    {note.created_at ? <span className="mt-1 block font-mono text-[11px] text-zinc-400">{note.created_at}</span> : null}
                  </button>
                </li>
              )
            })}
          </motion.ul>
          )}

          {custom ? null : (
          <motion.div variants={itemVariants}>
            <DrawerFooter className="flex flex-col gap-3 px-0">
              <button
                type="button"
                className="group relative inline-flex h-11 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 text-sm font-semibold text-white"
                onClick={() => onMarkAll?.()}
              >
                <motion.span
                  className="absolute inset-0 translate-x-[-200%] bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  whileHover={{ x: ['-200%', '200%'] }}
                  transition={{ duration: 1.5, ease: 'easeInOut' }}
                />
                <span className="relative">Mark all read</span>
              </button>
              <Button type="button" variant="outline" className="h-11 w-full rounded-xl" onClick={() => onClearAll?.()}>
                Clear all
              </Button>
              <DrawerClose asChild>
                <Button type="button" variant="outline" className="h-11 w-full rounded-xl" onClick={onClose}>
                  Close
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </motion.div>
          )}
        </motion.div>
      </DrawerContent>
    </Drawer>
  )
}

export function DrawerItem({ children }: { children: ReactNode }) {
  return <motion.div variants={itemVariants}>{children}</motion.div>
}
