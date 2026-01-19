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
  id: '2026-01-18-Add-Leaderbord-feature',
  date: '18.01.2026',
  title: 'Add Leaderbord feature',
  text: 'Leaderboard added to track top BasePosters credits spents. See rank, stats, and compete socially—optimized for base Mini App virality patterns.',
  tone: 'green',
},
  {
  id: '2026-01-19-Enhanced-post-generation',
  date: '19.01.2026',
  title: 'Enhanced post generation',
  text: 'More unique Base-focused posts with better topic variety and rotating formats. Smarter fallback + crash-safe generation to prevent server errors.',
  tone: 'red',
},
{
  id: '2026-01-17-Add-photo-generation',
  date: '17.01.2026',
  title: 'Add photo generation style',
  text: 'Generate post-matching images in multiple styles (e.g., Anime/Storybook/watercolor) for more engaging shares. Designed to look good in-feed with clean previews.',
  tone: 'green',
},
  {
    id: '2026-01-16-Add-Paymaster',
    date: '16.01.2026',
    title: 'Get Credit with 0 gas⚡',
    text: 'No ETH needed!! Your Get Credit will go through with zero gas fee on Base App-fees are covered by BasePosting for you.',
    tone: 'green',
  },
          {
    id: '2026-01-15-Add-Photo-Generation',
    date: '15.01.2026',
    title: 'Add Image Gen Feature',
    text: 'Implemented the Image Gen feature so users can generate photos right inside the editor while creating baseposts with proper quality tuning and faster generation time💙.',
    tone: 'green',
  },
  {
    id: '2026-01-09-Photo-Generation',
    date: '09.01.2026',
    title: 'New GOAL: Image Generation',
    text: 'I’m exploring different APIs to bring perfect image generation for your generated baseposts, but it’s been a tough ride-API access is limited, payments are getting declined, costs are high, and errors keep popping up. Still, I’m not giving up. I’ll keep testing options and pushing until this feature becomes real for everyone. Thank you everyone guys✨',
    tone: 'green',
  },
  {
    id: '2026-01-09-add-3-more-buttons-and-logic',
    date: '09.01.2026',
    title: 'Add 3 more button and logic',
    text: 'Added (Get credit, Share for credit, Tip me) buttons with full working logic, proper state handling, and a smoother user flow.',
    tone: 'green',
  },
  {
    id: '2026-01-09-add-credit-system',
    date: '09.01.2026',
    title: 'Add credit system',
    text: 'Implemented a credit system with balance tracking, earn/deduct logic, and safe validation to prevent misuse.',
    tone: 'green',
  },
  {
    id: '2026-01-06-polished-all-logic',
    date: '06.01.2026',
    title: 'Polished all logic',
    text: 'Polished all core logic by fixing bugs, improving state flow, and making the overall experience smoother.',
    tone: 'green',
  },
  {
    id: '2026-01-05-targeted-x-scraping-for-banger',
    date: '05.01.2026',
    title: 'Targeted X scraping for Banger',
    text: 'Added targeted X scraping for Banger with better filtering and cleaner formatted results for more relevant posts. Targated accounts list: @baseposting, @base, @jessepollak, @XenBH, @0xAneri, @Only1Gkash, @_Auza_, @1CrypticPoet, @brian_armstrong, @based_elnen, @baseapp, @0xyoussea. More will be added. Those who are serious builders on Base will get this priority',
    tone: 'green',
  },
  {
    id: '2026-01-05-api-integration',
    date: '05.01.2026',
    title: 'API Integration',
    text: 'Completed API integration with stable request handling, proper error states, and improved user feedback.',
    tone: 'green',
  },
      {
    id: '2026-01-03-collecting-user-feedback',
    date: '04.01.2026',
    title: 'Collecting user Feedback',
    text: 'Started collecting user feedback to understand pain points, prioritize the next improvements, and shape upcoming updates based on real usage. Send me a message on Telegram: @nurrabby with your feedback and ideas.',
    tone: 'red',
  },
    {
    id: '2026-01-03-dark-and-light-theme',
    date: '03.01.2026',
    title: 'Dark & Light theme',
    text: 'Added Dark & Light theme support with auto-detection and improved readability in both modes.',
    tone: 'green',
  },
  {
    id: '2026-01-03-update-ui-and-ux',
    date: '03.01.2026',
    title: 'Update UI & UX',
    text: 'Updated UI & UX with better spacing, typography, and overall visual polish for a more premium look.',
    tone: 'green',
  },
    {
    id: '2026-01-03-added-core-buttons-generate-post-copy',
    date: '03.01.2026',
    title: 'Button add: Generate,Post Directly, Copy',
    text: 'Added core buttons (Generate, Post Directly, Copy) with reliable interactions and clean output handling.',
    tone: 'green',
  },
  {
    id: '2026-01-03-baseposting-opened-for-all',
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
