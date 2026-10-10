import { useEffect, useState } from 'react'
import BentoGrid from '@/components/ui/bento-grid.tsx'
import SmoothTab from '@/components/ui/smooth-tab.tsx'
import Loader from '@/components/ui/loader.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import { SettingsApi } from '@/lib/api.ts'
import { promptFromDebugSettings } from '@/lib/debug-prompt.ts'
import { useView } from '@/lib/use-view.ts'

export default function DebugPage() {
  const { view, select } = useView(['run', 'settings'], 'run')
  return (
    <SmoothTab
      items={[{ id: 'run', title: 'Run', color: 'bg-zinc-900' }, { id: 'settings', title: 'Settings', color: 'bg-zinc-900' }]}
      selected={view}
      onChange={select}
    >
      {view === 'run' ? <RunView /> : <SettingsView />}
    </SmoothTab>
  )
}

function RunView() {
  const [prompt, setPrompt] = useState('')
  useEffect(() => {
    SettingsApi.getDebug()
      .then((data) => setPrompt(promptFromDebugSettings(data.settings)))
      .catch(() => setPrompt(promptFromDebugSettings(null)))
  }, [])
  if (!prompt) return <Loader size="md" title="Opening Debug" subtitle="Loading your data" />
  return (
    <BentoGrid
      voice={false}
      items={[{
        id: 'prompt',
        title: 'Error focus prompt',
        description: 'The saved DeBug prompt for the focused error, with the shared preamble.',
        feature: 'typing',
        typingText: prompt,
        className: 'md:col-span-3',
      }]}
    />
  )
}

function SettingsView() {
  const [keyLine, setKeyLine] = useState('Checking key…')
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    SettingsApi.openaiKeyStatus()
      .then((key) => {
        const on = key.configured === true || key.configured === 1 || key.configured === 'true'
        setKeyLine(on ? `Key on${key.masked ? ` · ${key.masked}` : ''}` : 'No key')
      })
      .catch(() => setKeyLine('No key'))
  }, [])

  return (
    <div className="space-y-4">
      <BentoGrid
        voice={false}
        items={[{
          id: 'keys',
          title: 'Provider key',
          description: 'OpenAI shows the live server key status. The other marks stay visible.',
          feature: 'icons',
          openaiStatus: keyLine,
        }]}
      />
      <form
        className="grid max-w-lg gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          setMessage('Saving…')
          try {
            await SettingsApi.saveOpenaiKey(apiKey.trim())
            setApiKey('')
            setMessage('Server key saved.')
            setKeyLine('Key on')
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not save the key')
          }
        }}
      >
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="OpenAI API key" className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
        <div className="flex gap-2">
          <SlideTextButton type="submit" text="Save" hoverText="Store key" />
          <SlideTextButton
            type="button"
            variant="ghost"
            text="Cancel"
            hoverText="Clear key"
            onClick={() => {
              void SettingsApi.clearOpenaiKey()
                .then(() => { setKeyLine('No key'); setMessage('Server key cleared.') })
                .catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Could not clear'))
            }}
          />
        </div>
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}
