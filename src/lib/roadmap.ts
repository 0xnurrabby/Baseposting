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
    id: 'nurrabby',
    date: '09.01.2026',
    title: 'Add 3 more button and logic',
    text: 'Added (Get credit, Share for credit, Tip me) buttons with full working logic, proper state handling, and a smoother user flow.'',
    tone: 'green',
  },
  {
    id: 'nurrabby',
    date: '09.01.2026',
    title: 'Add credit system',
    text: 'Implemented a credit system with balance tracking, earn/deduct logic, and safe validation to prevent misuse.',
    tone: 'green',
  },
  {
    id: 'nurrabby',
    date: '06.01.2026',
    title: 'Polished all logic',
    text: 'Polished all core logic by fixing bugs, improving state flow, and making the overall experience smoother.',
    tone: 'green',
  },
  {
    id: '2026-01-12-integrating-api',
    date: '05.01.2026',
    title: 'Targeted X scraping for Banger',
    text: 'Added targeted X scraping for Banger with better filtering and cleaner formatted results for more relevant posts. Targated accounts list: @baseposting, @base, @jessepollak, @XenBH, @0xAneri, @Only1Gkash, @_Auza_, @1CrypticPoet, @brian_armstrong, @based_elnen, @baseapp, @0xyoussea',
    tone: 'green',
  },
  {
    id: '2026-01-07-api-integration',
    date: '05.01.2026',
    title: 'API Integration',
    text: 'Completed API integration with stable request handling, proper error states, and improved user feedback.',
    tone: 'green',
  },
    {
    id: '2026-01-03-update-interface',
    date: '03.01.2026',
    title: 'Dark & Light theme',
    text: 'Added Dark & Light theme support with auto-detection and improved readability in both modes.',
    tone: 'green',
  },
  {
    id: '2026-01-03-update-interface',
    date: '03.01.2026',
    title: 'Update UI & UX',
    text: 'Updated UI & UX with better spacing, typography, and overall visual polish for a more premium look.',
    tone: 'green',
  },
    {
    id: '2026-01-01-mini-app-opened',
    date: '03.01.2026',
    title: 'Button add: Generate,Post Directly, Copy',
    text: 'Added core buttons (Generate, Post Directly, Copy) with reliable interactions and clean output handling.',
    tone: 'green',
  },
  {
    id: '2026-01-01-mini-app-opened',
    date: '03.01.2026',
    title: 'BasePosting opened for all',
    text: 'Opened BasePosting for all users with a stable public-ready build and a simple onboarding-friendly interface.',
    tone: 'green',
  },
]

export const ROADMAP_SEEN_KEY = 'bp_roadmap_seen_v1'

export function getRoadmapLatestId() {
  // Prefer the first 'red' item, otherwise the first item.
  const latest = ROADMAP.find((i) => i.tone === 'red')
  return (latest || ROADMAP[0])?.id || 'none'
}
