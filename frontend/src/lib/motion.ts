import { animate, stagger } from 'animejs'

const EASE = 'outCubic'
const FAST = 240

function list(targets: Element | Element[] | NodeListOf<Element> | null | undefined) {
  if (!targets) return []
  const nodes = targets instanceof Element ? [targets] : [...targets]
  return nodes.filter((node): node is HTMLElement => node instanceof HTMLElement)
}

export function enterPanel(targets: Element | Element[] | null) {
  const nodes = list(targets)
  if (!nodes.length) return
  nodes.forEach((node) => { node.style.opacity = '0' })
  animate(nodes, { opacity: [0, 1], y: [8, 0], duration: FAST, ease: EASE })
}

export function staggerIn(targets: Element | Element[] | null) {
  const nodes = list(targets)
  if (!nodes.length) return
  nodes.forEach((node) => { node.style.opacity = '0' })
  animate(nodes, { opacity: [0, 1], y: [8, 0], delay: stagger(32), duration: 260, ease: EASE })
}
