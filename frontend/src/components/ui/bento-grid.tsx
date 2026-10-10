/**
 * @author: @dorianbaffier
 * @description: Bento Grid
 * @version: 1.0.0
 * @date: 2025-06-26
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 */

import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Mic,
  Plus,
  Sparkles,
  Zap,
} from 'lucide-react'
import {
  motion,
  useMotionValue,
  useTransform,
  type Variants,
} from 'motion/react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import Anthropic from '@/components/icons/anthropic'
import AnthropicDark from '@/components/icons/anthropic-dark'
import DeepSeek from '@/components/icons/deepseek'
import Google from '@/components/icons/gemini'
import MistralAI from '@/components/icons/mistral'
import OpenAI from '@/components/icons/openai'
import OpenAIDark from '@/components/icons/openai-dark'
import { cn } from '@/lib/utils'

export interface BentoItem {
  id: string
  title: string
  description: string
  icons?: boolean
  href?: string
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  feature?:
    | 'chart'
    | 'counter'
    | 'code'
    | 'timeline'
    | 'spotlight'
    | 'icons'
    | 'typing'
    | 'metrics'
  spotlightItems?: string[]
  timeline?: Array<{ year: string; event: string }>
  code?: string
  codeLang?: string
  typingText?: string
  metrics?: Array<{
    label: string
    value: number
    suffix?: string
    color?: string
  }>
  statistic?: {
    value: string
    label: string
    start?: number
    end?: number
    suffix?: string
  }
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Live OpenAI key line on the OpenAI tile. Other marks stay as designed. */
  openaiStatus?: string
}

export type AIInputVoiceProps = {
  running?: boolean
  elapsed?: number
  onToggle?: () => void
}

const defaultBentoItems: BentoItem[] = [
  {
    id: 'main',
    title: "Building tomorrow's technology",
    description:
      'We architect and develop enterprise-grade applications that scale seamlessly with cloud-native technologies and microservices.',
    href: '#',
    feature: 'spotlight',
    spotlightItems: [
      'Microservices architecture',
      'Serverless computing',
      'Container orchestration',
      'API-first design',
      'Event-driven systems',
    ],
    size: 'lg',
    className: 'md:col-span-1',
  },
  {
    id: 'stat1',
    title: 'AI Agents & Automation',
    description:
      'Intelligent agents that learn, adapt, and automate complex workflows',
    href: '#',
    feature: 'typing',
    typingText:
      "const createAgent = async () => {\n  const agent = new AIAgent({\n    model: 'gpt-4-turbo',\n    tools: [codeAnalysis, dataProcessing],\n    memory: new ConversationalMemory()\n  });\n\n  // Train on domain knowledge\n  await agent.learn(domainData);\n\n  return agent;\n};",
    size: 'md',
    className: 'md:col-span-2',
  },
  {
    id: 'partners',
    title: 'Trusted partners',
    description:
      'Working with the leading AI and cloud providers to deliver cutting-edge solutions',
    icons: true,
    href: '#',
    feature: 'icons',
    size: 'md',
    className: 'md:col-span-1',
  },
  {
    id: 'innovation',
    title: 'Innovation timeline',
    description:
      'Pioneering the future of AI and cloud computing with breakthrough innovations',
    href: '#',
    feature: 'timeline',
    timeline: [
      { year: '2020', event: 'Launch of Cloud-Native Platform' },
      { year: '2021', event: 'Advanced AI Integration & LLM APIs' },
      { year: '2022', event: 'Multi-Agent Systems & RAG Architecture' },
      { year: '2023', event: 'Autonomous AI Agents & Neural Networks' },
      {
        year: '2024',
        event: 'AGI-Ready Infrastructure & Edge Computing',
      },
    ],
    size: 'sm',
    className: 'md:col-span-1',
  },
  {
    id: 'counter',
    title: 'Delivery reliability',
    description: 'Animated count of completed releases this quarter.',
    href: '#',
    feature: 'counter',
    statistic: {
      value: '128',
      label: 'Releases',
      start: 0,
      end: 128,
      suffix: '',
    },
    size: 'sm',
    className: 'md:col-span-1',
  },
  {
    id: 'chart',
    title: 'Adoption',
    description: 'Share of workflows running on the new platform.',
    href: '#',
    feature: 'chart',
    statistic: {
      value: '72',
      label: 'Adoption',
      end: 72,
      suffix: '%',
    },
    size: 'sm',
    className: 'md:col-span-1',
  },
  {
    id: 'metrics',
    title: 'Service health',
    description: 'Live operating figures for the current environment.',
    href: '#',
    feature: 'metrics',
    metrics: [
      { label: 'Uptime', value: 99, suffix: '%', color: 'emerald' },
      { label: 'Response time', value: 86, suffix: 'ms', color: 'blue' },
      { label: 'Cost reduction', value: 38, suffix: '%', color: 'violet' },
    ],
    size: 'md',
    className: 'md:col-span-2',
  },
]

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut',
    },
  },
}

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.3,
    },
  },
}

const SpotlightFeature = ({ items }: { items: string[] }) => (
  <ul className="mt-2 space-y-1.5">
    {items.map((item, index) => (
      <motion.li
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-2"
        initial={{ opacity: 0, x: -10 }}
        key={`spotlight-${item.toLowerCase().replace(/\s+/g, '-')}`}
        transition={{ delay: 0.1 * index }}
      >
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500 dark:text-emerald-400" />
        <span className="text-neutral-700 text-sm dark:text-neutral-300">
          {item}
        </span>
      </motion.li>
    ))}
  </ul>
)

const CounterAnimation = ({
  start,
  end,
  suffix = '',
}: {
  start: number
  end: number
  suffix?: string
}) => {
  const [count, setCount] = useState(start)

  useEffect(() => {
    const duration = 2000
    const frameRate = 1000 / 60
    const totalFrames = Math.round(duration / frameRate)

    let currentFrame = 0
    const counter = setInterval(() => {
      currentFrame++
      const progress = currentFrame / totalFrames
      const easedProgress = 1 - (1 - progress) ** 3
      const current = start + (end - start) * easedProgress

      setCount(Math.min(current, end))

      if (currentFrame === totalFrames) {
        clearInterval(counter)
      }
    }, frameRate)

    return () => clearInterval(counter)
  }, [start, end])

  return (
    <div className="flex items-baseline gap-1">
      <span className="font-bold text-3xl text-neutral-900 dark:text-neutral-100">
        {count.toFixed(1).replace(/\.0$/, '')}
      </span>
      <span className="font-medium text-neutral-900 text-xl dark:text-neutral-100">
        {suffix}
      </span>
    </div>
  )
}

const ChartAnimation = ({ value }: { value: number }) => (
  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
    <motion.div
      animate={{ width: `${value}%` }}
      className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
      initial={{ width: 0 }}
      transition={{ duration: 1.5, ease: 'easeOut' }}
    />
  </div>
)

const IconsFeature = ({ openaiStatus }: { openaiStatus?: string }) => (
  <div className="mt-4 grid grid-cols-3 gap-4">
    <motion.div className="group flex flex-col items-center gap-2 rounded-xl border border-neutral-200/50 bg-gradient-to-b from-neutral-100/80 to-neutral-100 p-3 transition-all duration-300 hover:border-neutral-300 dark:border-neutral-700/50 dark:from-neutral-800/80 dark:to-neutral-800 dark:hover:border-neutral-600">
      <div className="relative flex h-8 w-8 items-center justify-center">
        <OpenAI className="h-7 w-7 transition-transform dark:hidden" />
        <OpenAIDark className="hidden h-7 w-7 transition-transform dark:block" />
      </div>
      <span className="text-center font-medium text-neutral-600 text-xs group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-200">
        OpenAI
      </span>
      {openaiStatus ? (
        <span className="text-center text-[10px] text-neutral-500 dark:text-neutral-400">{openaiStatus}</span>
      ) : null}
    </motion.div>
    <motion.div className="group flex flex-col items-center gap-2 rounded-xl border border-neutral-200/50 bg-gradient-to-b from-neutral-100/80 to-neutral-100 p-3 transition-all duration-300 hover:border-neutral-300 dark:border-neutral-700/50 dark:from-neutral-800/80 dark:to-neutral-800 dark:hover:border-neutral-600">
      <div className="relative flex h-8 w-8 items-center justify-center">
        <Anthropic className="h-7 w-7 transition-transform dark:hidden" />
        <AnthropicDark className="hidden h-7 w-7 transition-transform dark:block" />
      </div>
      <span className="text-center font-medium text-neutral-600 text-xs group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-200">
        Anthropic
      </span>
    </motion.div>
    <motion.div className="group flex flex-col items-center gap-2 rounded-xl border border-neutral-200/50 bg-gradient-to-b from-neutral-100/80 to-neutral-100 p-3 transition-all duration-300 hover:border-neutral-300 dark:border-neutral-700/50 dark:from-neutral-800/80 dark:to-neutral-800 dark:hover:border-neutral-600">
      <div className="relative flex h-8 w-8 items-center justify-center">
        <Google className="h-7 w-7 transition-transform" />
      </div>
      <span className="text-center font-medium text-neutral-600 text-xs group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-200">
        Google
      </span>
    </motion.div>
    <motion.div className="group flex flex-col items-center gap-2 rounded-xl border border-neutral-200/50 bg-gradient-to-b from-neutral-100/80 to-neutral-100 p-3 transition-all duration-300 hover:border-neutral-300 dark:border-neutral-700/50 dark:from-neutral-800/80 dark:to-neutral-800 dark:hover:border-neutral-600">
      <div className="relative flex h-8 w-8 items-center justify-center">
        <MistralAI className="h-7 w-7 transition-transform" />
      </div>
      <span className="text-center font-medium text-neutral-600 text-xs group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-200">
        Mistral
      </span>
    </motion.div>
    <motion.div className="group flex flex-col items-center gap-2 rounded-xl border border-neutral-200/50 bg-gradient-to-b from-neutral-100/80 to-neutral-100 p-3 transition-all duration-300 hover:border-neutral-300 dark:border-neutral-700/50 dark:from-neutral-800/80 dark:to-neutral-800 dark:hover:border-neutral-600">
      <div className="relative flex h-8 w-8 items-center justify-center">
        <DeepSeek className="h-7 w-7 transition-transform" />
      </div>
      <span className="text-center font-medium text-neutral-600 text-xs group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-200">
        DeepSeek
      </span>
    </motion.div>
    <motion.div className="group flex flex-col items-center gap-2 rounded-xl border border-neutral-200/50 bg-gradient-to-b from-neutral-100/80 to-neutral-100 p-3 transition-all duration-300 hover:border-neutral-300 dark:border-neutral-700/50 dark:from-neutral-800/80 dark:to-neutral-800 dark:hover:border-neutral-600">
      <div className="relative flex h-8 w-8 items-center justify-center">
        <Plus className="h-6 w-6 text-neutral-600 transition-transform dark:text-neutral-400" />
      </div>
      <span className="text-center font-medium text-neutral-600 text-xs group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-200">
        More
      </span>
    </motion.div>
  </div>
)

const TimelineFeature = ({
  timeline,
}: {
  timeline: Array<{ year: string; event: string }>
}) => (
  <div className="relative mt-3">
    <div className="absolute top-0 bottom-0 left-[9px] w-[2px] bg-neutral-200 dark:bg-neutral-700" />
    {timeline.map((item) => (
      <motion.div
        animate={{ opacity: 1, x: 0 }}
        className="relative mb-3 flex gap-3"
        initial={{ opacity: 0, x: -10 }}
        key={`timeline-${item.year}-${item.event
          .toLowerCase()
          .replace(/\s+/g, '-')}`}
        transition={{
          delay: (0.15 * Number.parseInt(item.year, 10)) % 10,
        }}
      >
        <div className="z-10 mt-0.5 h-5 w-5 flex-shrink-0 rounded-full border-2 border-neutral-300 bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-800" />
        <div>
          <div className="font-medium text-neutral-900 text-sm dark:text-neutral-100">
            {item.year}
          </div>
          <div className="text-neutral-600 text-xs dark:text-neutral-400">
            {item.event}
          </div>
        </div>
      </motion.div>
    ))}
  </div>
)

const TypingCodeFeature = ({ text }: { text: string }) => {
  const [displayedText, setDisplayedText] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const terminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(
        () => {
          setDisplayedText((prev) => prev + text[currentIndex])
          setCurrentIndex((prev) => prev + 1)

          if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight
          }
        },
        Math.random() * 30 + 10,
      )

      return () => clearTimeout(timeout)
    }
  }, [currentIndex, text])

  useEffect(() => {
    setDisplayedText('')
    setCurrentIndex(0)
  }, [text])

  return (
    <div className="relative mt-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-neutral-500 text-xs dark:text-neutral-400">
          server.ts
        </div>
      </div>
      <div
        className="h-[150px] overflow-y-auto rounded-md bg-neutral-900 p-3 font-mono text-neutral-100 text-xs dark:bg-black"
        ref={terminalRef}
      >
        <pre className="whitespace-pre-wrap">
          {displayedText}
          <span className="animate-pulse">|</span>
        </pre>
      </div>
    </div>
  )
}

const MetricsFeature = ({
  metrics,
}: {
  metrics: Array<{
    label: string
    value: number
    suffix?: string
    color?: string
  }>
}) => {
  const getColorClass = (color = 'emerald') => {
    const colors = {
      emerald: 'bg-emerald-500 dark:bg-emerald-400',
      blue: 'bg-blue-500 dark:bg-blue-400',
      violet: 'bg-violet-500 dark:bg-violet-400',
      amber: 'bg-amber-500 dark:bg-amber-400',
      rose: 'bg-rose-500 dark:bg-rose-400',
    }
    return colors[color as keyof typeof colors] || colors.emerald
  }

  return (
    <div className="mt-3 space-y-3">
      {metrics.map((metric, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="space-y-1"
          initial={{ opacity: 0, y: 10 }}
          key={`metric-${metric.label.toLowerCase().replace(/\s+/g, '-')}`}
          transition={{ delay: 0.15 * index }}
        >
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
              {metric.label === 'Uptime' && <Clock className="h-3.5 w-3.5" />}
              {metric.label === 'Response time' && (
                <Zap className="h-3.5 w-3.5" />
              )}
              {metric.label === 'Cost reduction' && (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {metric.label}
            </div>
            <div className="font-semibold text-neutral-700 dark:text-neutral-300">
              {metric.value}
              {metric.suffix}
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <motion.div
              animate={{
                width: `${Math.min(100, metric.value)}%`,
              }}
              className={`h-full rounded-full ${getColorClass(metric.color)}`}
              initial={{ width: 0 }}
              transition={{
                duration: 1.2,
                ease: 'easeOut',
                delay: 0.15 * index,
              }}
            />
          </div>
        </motion.div>
      ))}
    </div>
  )
}

function formatVoiceTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export function AIInput_Voice({
  running,
  elapsed,
  onToggle,
}: AIInputVoiceProps = {}) {
  const controlled = running !== undefined
  const [submitted, setSubmitted] = useState(false)
  const [time, setTime] = useState(0)
  const [isClient, setIsClient] = useState(false)
  const [isDemo, setIsDemo] = useState(!controlled)

  const active = controlled ? Boolean(running) : submitted
  const displayTime = controlled && elapsed !== undefined ? elapsed : time

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (controlled && elapsed !== undefined) return

    let intervalId: ReturnType<typeof setInterval> | undefined

    if (active) {
      intervalId = setInterval(() => {
        setTime((t) => t + 1)
      }, 1000)
    } else {
      setTime(0)
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [active, controlled, elapsed])

  useEffect(() => {
    if (controlled || !isDemo) return

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const runAnimation = () => {
      setSubmitted(true)
      timeoutId = setTimeout(() => {
        setSubmitted(false)
        timeoutId = setTimeout(runAnimation, 1000)
      }, 3000)
    }

    const initialTimeout = setTimeout(runAnimation, 100)
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      clearTimeout(initialTimeout)
    }
  }, [controlled, isDemo])

  const handleClick = () => {
    if (onToggle) {
      onToggle()
      return
    }
    if (isDemo) {
      setIsDemo(false)
      setSubmitted(false)
    } else {
      setSubmitted((prev) => !prev)
    }
  }

  return (
    <div className="w-full py-4">
      <div className="relative mx-auto flex w-full max-w-xl flex-col items-center gap-2">
        <button
          className={cn(
            'group flex h-16 w-16 items-center justify-center rounded-xl transition-colors',
            active
              ? 'bg-none'
              : 'bg-none hover:bg-black/10 dark:hover:bg-white/10',
          )}
          onClick={handleClick}
          type="button"
        >
          {active ? (
            <div
              className="pointer-events-auto h-6 w-6 animate-spin cursor-pointer rounded-sm bg-black dark:bg-white"
              style={{ animationDuration: '3s' }}
            />
          ) : (
            <Mic className="h-6 w-6 text-black/70 dark:text-white/70" />
          )}
        </button>

        <span
          className={cn(
            'font-mono text-sm transition-opacity duration-300',
            active
              ? 'text-black/70 dark:text-white/70'
              : 'text-black/30 dark:text-white/30',
          )}
        >
          {formatVoiceTime(displayTime)}
        </span>

        <div className="flex h-4 w-64 items-center justify-center gap-0.5">
          {[...Array(48)].map((_, i) => (
            <div
              className={cn(
                'w-0.5 rounded-full transition-all duration-300',
                active
                  ? 'animate-pulse bg-black/50 dark:bg-white/50'
                  : 'h-1 bg-black/10 dark:bg-white/10',
              )}
              key={`voice-bar-${i}`}
              style={
                active && isClient
                  ? {
                      height: `${20 + Math.random() * 80}%`,
                      animationDelay: `${i * 0.05}s`,
                    }
                  : undefined
              }
            />
          ))}
        </div>

        <p className="h-4 text-black/70 text-xs dark:text-white/70">
          {active ? 'Listening...' : 'Click to speak'}
        </p>
      </div>
    </div>
  )
}

const cardClassName =
  'group relative flex h-full flex-col gap-4 rounded-xl border border-neutral-200/60 bg-gradient-to-b from-neutral-50/60 via-neutral-50/40 to-neutral-50/30 p-5 shadow-[0_4px_20px_rgb(0,0,0,0.04)] backdrop-blur-[4px] transition-all duration-500 ease-out before:absolute before:inset-0 before:rounded-xl before:bg-gradient-to-b before:from-white/10 before:via-white/20 before:to-transparent before:opacity-100 before:transition-opacity before:duration-500 after:absolute after:inset-0 after:z-[-1] after:rounded-xl after:bg-neutral-50/70 hover:border-neutral-300/50 hover:bg-gradient-to-b hover:from-neutral-50/60 hover:via-neutral-50/30 hover:to-neutral-50/20 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:backdrop-blur-[6px] dark:border-neutral-800/60 dark:from-neutral-900/60 dark:via-neutral-900/40 dark:to-neutral-900/30 dark:shadow-[0_4px_20px_rgb(0,0,0,0.2)] dark:hover:border-neutral-700/50 dark:hover:from-neutral-800/60 dark:hover:via-neutral-800/30 dark:hover:to-neutral-800/20 dark:hover:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:after:bg-neutral-900/70 dark:before:from-black/10 dark:before:via-black/20 dark:before:to-transparent'

const BentoCard = ({ item }: { item: BentoItem }) => {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useTransform(y, [-100, 100], [2, -2])
  const rotateY = useTransform(x, [-100, 100], [-2, 2])

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = rect.width
    const height = rect.height
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const xPct = mouseX / width - 0.5
    const yPct = mouseY / height - 0.5
    x.set(xPct * 100)
    y.set(yPct * 100)
  }

  function handleMouseLeave() {
    x.set(0)
    y.set(0)
  }

  const body = (
    <div
      className="relative z-10 flex h-full flex-col gap-3"
      style={{ transform: 'translateZ(20px)' }}
    >
      <div className="flex flex-1 flex-col space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-neutral-900 text-xl tracking-tight transition-colors duration-300 group-hover:text-neutral-700 dark:text-neutral-100 dark:group-hover:text-neutral-300">
            {item.title}
          </h3>
          <div className="text-neutral-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:text-neutral-500">
            <ArrowUpRight className="h-5 w-5" />
          </div>
        </div>

        <p className="text-neutral-600 text-sm tracking-tight dark:text-neutral-400">
          {item.description}
        </p>

        {item.feature === 'spotlight' && item.spotlightItems && (
          <SpotlightFeature items={item.spotlightItems} />
        )}

        {item.feature === 'counter' && item.statistic && (
          <div className="mt-auto pt-3">
            <CounterAnimation
              end={item.statistic.end || 100}
              start={item.statistic.start || 0}
              suffix={item.statistic.suffix}
            />
          </div>
        )}

        {item.feature === 'chart' && item.statistic && (
          <div className="mt-auto pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-neutral-700 text-sm dark:text-neutral-300">
                {item.statistic.label}
              </span>
              <span className="font-medium text-neutral-700 text-sm dark:text-neutral-300">
                {item.statistic.end}
                {item.statistic.suffix}
              </span>
            </div>
            <ChartAnimation value={item.statistic.end || 0} />
          </div>
        )}

        {item.feature === 'timeline' && item.timeline && (
          <TimelineFeature timeline={item.timeline} />
        )}

        {item.feature === 'icons' && <IconsFeature openaiStatus={item.openaiStatus} />}

        {item.feature === 'typing' && item.typingText && (
          <TypingCodeFeature text={item.typingText} />
        )}

        {item.feature === 'metrics' && item.metrics && (
          <MetricsFeature metrics={item.metrics} />
        )}

        {item.icons && !item.feature && (
          <div className="mt-auto flex flex-wrap items-center gap-4 border-neutral-200/70 border-t pt-4 dark:border-neutral-800/70">
            <OpenAI className="h-5 w-5 opacity-70 transition-opacity hover:opacity-100 dark:hidden" />
            <OpenAIDark className="hidden h-5 w-5 opacity-70 transition-opacity hover:opacity-100 dark:block" />
            <AnthropicDark className="hidden h-5 w-5 opacity-70 transition-opacity hover:opacity-100 dark:block" />
            <Anthropic className="h-5 w-5 opacity-70 transition-opacity hover:opacity-100 dark:hidden" />
            <Google className="h-5 w-5 opacity-70 transition-opacity hover:opacity-100" />
            <MistralAI className="h-5 w-5 opacity-70 transition-opacity hover:opacity-100" />
            <DeepSeek className="h-5 w-5 opacity-70 transition-opacity hover:opacity-100" />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <motion.div
      className="h-full"
      onHoverEnd={handleMouseLeave}
      onMouseMove={handleMouseMove}
      style={{
        rotateX,
        rotateY,
        transformStyle: 'preserve-3d',
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      variants={fadeInUp}
      whileHover={{ y: -5 }}
    >
      {item.href || item.onClick ? (
        <a
          aria-label={`${item.title} - ${item.description}`}
          className={cardClassName}
          href={item.href || '#'}
          onClick={(event) => {
            item.onClick?.(event)
            if (!item.href) event.preventDefault()
          }}
          tabIndex={0}
        >
          {body}
        </a>
      ) : (
        <div className={cardClassName}>{body}</div>
      )}
    </motion.div>
  )
}

export type BentoGridProps = {
  items?: BentoItem[]
  className?: string
  voice?:
    | (AIInputVoiceProps & {
        title?: string
        description?: string
      })
    | false
}

export function BentoGrid({ items, className, voice }: BentoGridProps = {}) {
  const cells = items ?? defaultBentoItems
  const showVoice = voice === false ? false : voice !== undefined || items === undefined
  const voiceTitle = voice ? voice.title : undefined
  const voiceDescription = voice ? voice.description : undefined

  return (
    <section className="relative overflow-hidden bg-white py-24 sm:py-32 dark:bg-black">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          className={cn('grid gap-6 md:grid-cols-3', className)}
          initial="hidden"
          variants={staggerContainer}
          viewport={{ once: true }}
          whileInView="visible"
        >
          {cells.map((item) => (
            <motion.div className={item.className} key={item.id} variants={fadeInUp}>
              <BentoCard item={item} />
            </motion.div>
          ))}
          {showVoice ? (
            <motion.div
              className="overflow-hidden rounded-xl border border-neutral-200/50 bg-gradient-to-b from-neutral-50/80 to-neutral-50 transition-all duration-300 hover:border-neutral-400/30 hover:shadow-lg hover:shadow-neutral-200/20 md:col-span-1 dark:border-neutral-800/50 dark:from-neutral-900/80 dark:to-neutral-900 dark:hover:border-neutral-600/30 dark:hover:shadow-neutral-900/20"
              variants={fadeInUp}
            >
              <div className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-semibold text-neutral-900 text-xl tracking-tight dark:text-neutral-100">
                    {voiceTitle ?? 'Voice Assistant'}
                  </h3>
                </div>
                <p className="mb-4 text-neutral-600 text-sm tracking-tight dark:text-neutral-400">
                  {voiceDescription ??
                    'Interact with our AI using natural voice commands. Experience seamless voice-driven interactions with advanced speech recognition.'}
                </p>
                <AIInput_Voice
                  elapsed={voice ? voice.elapsed : undefined}
                  onToggle={voice ? voice.onToggle : undefined}
                  running={voice ? voice.running : undefined}
                />
              </div>
            </motion.div>
          ) : null}
        </motion.div>
      </div>
    </section>
  )
}

export default BentoGrid
