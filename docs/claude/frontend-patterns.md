# Frontend Patterns

## Styling Guidelines

**All frontend changes must follow the existing design system.** Do not introduce new colors, fonts, or styling patterns.

### Design Philosophy
- **Editorial/financial aesthetic** - minimal, professional, content-focused
- **Dark mode primary** (obsidian base with warm text)
- **Accent used sparingly** - warm amber (`--accent`) only for highlights, not decoration

### Color Palette (use CSS variables only)
- `background` / `foreground` - base colors
- `card` - elevated surfaces
- `muted` / `muted-foreground` - secondary text and backgrounds
- `accent` - sparingly for emphasis (amber)
- `border` - subtle dividers

### Typography Classes (defined in globals.css)
- Headlines: `headline-xl`, `headline-lg`, `headline-md`, `headline-sm`
- Body: `body-lg`, `body-md`, `body-sm`
- Numbers: `num-lg`, `num-md`, `num-sm` (tabular figures)
- Labels: `label-sm`, `label-xs` (uppercase, tracked)

### Component Patterns
- Use existing classes: `section`, `section-title`, `card-section`, `editorial-list`, `startup-row`, `signal-item`
- Borders: subtle (`border-border/40` or `border-border/50`)
- Hover states: `bg-muted/20` or `bg-muted/30`
- Transitions: `transition-colors duration-150`

### Do NOT
- Add new color variables or hardcoded colors
- Use bright/saturated colors
- Add decorative elements or excessive styling
- Override the existing design tokens

---

## Dual-Audience Messaging System

The site supports two audience modes: **Builders** (default) and **Investors**.

### Copy Configuration (`lib/copy.ts`)
All user-facing copy is centralized in `COPY` object:
```typescript
import { COPY, METRICS, FAQ_ITEMS, SIGN_IN_COPY, SUPPORTING_LINE } from '@/lib/copy';

const copy = COPY[audience]; // 'builders' | 'investors'
copy.heroHeadline;
copy.heroSubhead;
copy.heroBullets;
copy.primaryCTA;
copy.secondaryCTA;
```

### Audience Context (`lib/audience-context.tsx`)
```typescript
import { useAudience } from '@/lib/audience-context';

const { audience, setAudience } = useAudience();
// Persists to localStorage key: "ba_audience"
```

### Audience Toggle Component
```tsx
import { AudienceToggle } from '@/components/ui/audience-toggle';

<AudienceToggle /> // Renders "Builders | Investors" pill toggle
```

### Key Principles
- **No pricing/gating language** - All content is free to browse
- **Sign-in is for personalization only** - Watchlists, saved filters
- **Consistent terminology**: Brief, Dossiers, Signals, Capital, Library, Watchlist
- **Metrics labels are standardized**: "Funded companies tracked", "Capital mapped", "GenAI adoption", "Build patterns detected"
