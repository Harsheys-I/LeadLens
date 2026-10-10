import { Bug, ChartColumn, Headset, Search, Settings, Workflow } from 'lucide-react'
import BentoGrid, { type BentoItem } from '@/components/ui/bento-grid.tsx'
import { KineticText } from '@/components/ui/kinetic-text.tsx'
import MouseEffectCard from '@/components/ui/mouse-effect-card.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import SpotlightCards from '@/components/ui/spotlight-cards.tsx'
import { allowedModules, moduleHref } from '@/lib/paths.ts'
import type { SessionUser } from '@/lib/session.ts'

const ICONS = {
  telecaller: Headset,
  sales: ChartColumn,
  seo: Search,
  admin: Settings,
  debug: Bug,
  erp: Workflow,
}

export default function HomeView({ user }: { user: SessionUser }) {
  const modules = allowedModules(user)
  const first = modules[0]
  const allowed = new Set(modules.map((item) => item.key))
  const bento: BentoItem[] = []
  if (allowed.has('telecaller')) {
    bento.push({
      id: 'leadlens',
      title: 'LeadLens',
      description: 'Audit a call sheet, read the published dashboard, and export the review.',
      href: moduleHref('telecaller'),
      feature: 'spotlight',
      spotlightItems: ['Audit', 'Dashboard', 'Export'],
    })
  }
  if (allowed.has('debug')) {
    bento.push({
      id: 'debug',
      title: 'Debug mode',
      description: 'A short sample of the saved error-focus prompt.',
      href: moduleHref('debug'),
      feature: 'typing',
      typingText: 'Review this lead row.\nFlag missed follow-up, empty requirement, and weak comments.\nReturn the error label and the recommended action.',
    })
  }
  bento.push({
    id: 'models',
    title: 'Models this workspace can call',
    description: 'OpenAI, Anthropic, Google, Mistral, and DeepSeek.',
    feature: 'icons',
  })
  const milestones = [
    allowed.has('telecaller') ? { year: 'LeadLens', event: 'Call audit and published dashboards' } : null,
    allowed.has('sales') ? { year: 'Sales Graph', event: 'Leads, visits, and booked' } : null,
    allowed.has('seo') ? { year: 'SEO', event: 'Technical audit and action plan' } : null,
    allowed.has('admin') ? { year: 'Admin', event: 'Users, roles, and access' } : null,
  ].filter((item): item is { year: string; event: string } => Boolean(item))
  if (milestones.length) {
    bento.push({
      id: 'milestones',
      title: 'Modules in this workspace',
      description: 'What is already live for your role.',
      href: moduleHref(milestones[0].year === 'LeadLens' ? 'telecaller' : milestones[0].year === 'Sales Graph' ? 'sales' : milestones[0].year === 'SEO' ? 'seo' : 'admin'),
      feature: 'timeline',
      timeline: milestones,
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <KineticText text="Where do you want to work?" className="text-4xl tracking-tight sm:text-5xl" />
      <MouseEffectCard
        title="GPP AI"
        subtitle={user.role_name || ''}
        topText="Your workspace"
        topSubtext="Signed in"
        primaryCtaText=""
        secondaryCtaText=""
        footerText=""
      >
        {first ? (
          <SlideTextButton href={moduleHref(first.key)} text={`Open ${first.title}`} hoverText="Go to your work" />
        ) : null}
      </MouseEffectCard>
      <SpotlightCards
        eyebrow="Your workspace"
        heading="Open a module"
        items={modules.map((item) => ({
          icon: ICONS[item.key],
          title: item.title,
          description: item.description,
          color: item.color,
          href: moduleHref(item.key),
        }))}
      />
      {bento.length ? <BentoGrid items={bento} voice={false} /> : null}
    </div>
  )
}
