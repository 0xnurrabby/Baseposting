export type RoadmapTone = 'green' | 'red' | 'zinc'

export type RoadmapItem = {
  /** Unique id for persistence (change when you add a new “latest”). */
  id: string
  /** Display date (you can keep it dd.mm.yyyy like your note). */
  date: string
  /** Short headline */
  title: string
  /** Details (multiline supported) */
  text: string
  /** Controls UI color. Use 'green' for done, 'red' for latest, 'zinc' for neutral. */
  tone: RoadmapTone
}

/**
 * ✅ Edit here to add new updates.
 * - Put your newest update first.
 * - Set tone: 'red' for the latest update.
 * - Older/done items: tone: 'green'.
 */
export const ROADMAP: RoadmapItem[] = [
  {
    id: '2026-01-12-integrating-api',
    date: '12.01.2026',
    title: 'Integrating API',
    text: 'Latest update: Integrating API',
    tone: 'red',
  },
  {
    id: '2026-01-07-api-integration',
    date: '07.01.2026',
    title: 'API Integration',
    text: 'API Integration',
    tone: 'green',
  },
  {
    id: '2026-01-03-update-interface',
    date: '03.01.2026',
    title: 'Update interface',
    text: 'UPDATE Interface',
    tone: 'green',
  },
  {
    id: '2026-01-01-mini-app-opened',
    date: '01.01.2026',
    title: 'Mini App opened for all',
    text: 'Mini App opened for all',
    tone: 'green',
  },
]

export const ROADMAP_SEEN_KEY = 'bp_roadmap_seen_v1'

export function getRoadmapLatestId() {
  // Prefer the first 'red' item, otherwise the first item.
  const latest = ROADMAP.find((i) => i.tone === 'red')
  return (latest || ROADMAP[0])?.id || 'none'
}
