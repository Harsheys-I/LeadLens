import { Bug, ChartColumn, Headset, Search, Settings, Workflow } from 'lucide-react'
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

  return (
    <div className="flex w-full flex-col gap-8">
      <KineticText text="Where do you want to work?" className="text-4xl tracking-tight sm:text-5xl" />
      <MouseEffectCard
        className="w-full max-w-full"
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
    </div>
  )
}
