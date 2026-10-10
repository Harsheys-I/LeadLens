import { useEffect, useState } from 'react'

export function useView(ids: string[], fallback: string, aliases: Record<string, string> = {}) {
  const read = () => {
    const raw = location.hash.replace(/^#/, '')
    const id = aliases[raw] || raw
    return ids.includes(id) ? id : fallback
  }
  const [view, setView] = useState(read)

  useEffect(() => {
    const onHash = () => setView(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [ids.join('|'), fallback, JSON.stringify(aliases)])

  const select = (id: string) => {
    if (location.hash !== `#${id}`) location.hash = id
    setView(id)
  }

  return { view, select }
}
