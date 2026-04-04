# Ship Dock UI Redesign — Vercel Design Language

Full UI overhaul referencing Vercel's latest design language. Covers design tokens, navigation restructure, component polish, page-level refinements, and dark/light mode parity.

## Scope

- All pages and components, one-pass upgrade
- Light and dark mode with equal quality
- Navigation architecture change (sidebar → top nav + project sidebar)

## 1. Design Tokens

### Colors

**Light mode:**

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#fff` | Page background |
| `--background-secondary` | `#fafafa` | Cards, sections |
| `--border` | `rgba(0,0,0,0.08)` | All borders |
| `--border-hover` | `rgba(0,0,0,0.15)` | Border on hover |
| `--foreground` | `#111` | Primary text |
| `--foreground-secondary` | `#666` | Secondary text |
| `--foreground-muted` | `#999` | Muted/tertiary text |
| `--status-ready` | `#50e3c2` | Ready/Active/Success |
| `--status-building` | `#f5a623` | Building/Warning |
| `--status-error` | `#e00` | Error/Destructive |

**Dark mode:**

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#0a0a0a` | Page background |
| `--background-secondary` | `#111` | Cards, sections |
| `--border` | `rgba(255,255,255,0.1)` | All borders |
| `--border-hover` | `rgba(255,255,255,0.2)` | Border on hover |
| `--foreground` | `#ededed` | Primary text |
| `--foreground-secondary` | `#888` | Secondary text |
| `--foreground-muted` | `#666` | Muted/tertiary text |
| `--status-ready` | `#50e3c2` | Same across modes |
| `--status-building` | `#f5a623` | Same across modes |
| `--status-error` | `#e00` | Same across modes |

Status colors use `box-shadow: 0 0 6px` with 30-40% opacity glow in both modes.

### Typography

- Font family: Geist (sans) / Geist Mono (mono) — unchanged
- Page title: 20px, font-weight 500, letter-spacing -0.3px
- Section heading: 16px, font-weight 500
- Body text: 14px, font-weight 400
- Secondary text: 13px, foreground-secondary
- Small/label: 12px, foreground-muted, optional uppercase + letter-spacing 0.5px
- Line height: 1.5 globally

### Spacing & Radius

- Border radius: containers/cards 12px, buttons/inputs 8px, badges/tags 6px
- Border width: 1px everywhere, low-opacity colors
- Page padding: 24-32px
- Card padding: 16-20px
- Component gap: 8-12px (tight), 16-24px (sections)

### Transitions

- All hover/focus transitions: 150ms ease
- No abrupt state changes

## 2. Navigation Architecture

### Current structure (to be replaced)

- 256px left sidebar with 4 nav items (Dashboard, Domains, Team, Settings)
- Project detail pages use horizontal tabs (7 tabs)

### New structure

**Top navigation bar:**

- Height: 48px, bottom border 1px
- Left: "Ship Dock" logo/text. When inside a project: breadcrumb `Ship Dock ／ project-name` with `／` separator
- Right: Domains, Team, Settings links + user avatar
- On Dashboard page: no breadcrumb, just "Ship Dock"
- Breadcrumb project name can be a dropdown for quick project switching (future enhancement)

**Project sidebar (conditional):**

- Only rendered on `/projects/[id]/*` routes
- Width: 200px, right border 1px, no distinct background color
- Three groups with small uppercase labels:
  - **Project**: Deployments, Pipeline, Logs
  - **Data**: Database, Redis, Storage
  - **Config**: Settings
- Active item: subtle background (`rgba` 6-8% opacity), border-radius 6px, foreground color text
- Inactive items: foreground-secondary color, hover brightens to foreground
- Project name + status dot displayed at top of sidebar

**Pages without project sidebar:**

- Dashboard, Domains, Team, Settings render full-width content directly below the top nav

### Files affected

- Delete: `components/app-sidebar.tsx` (replaced by new top nav)
- Create: `components/top-nav.tsx` — top navigation bar
- Create: `components/project-sidebar.tsx` — project detail sidebar
- Modify: `app/(app)/layout.tsx` — replace sidebar layout with top nav layout
- Modify: `app/projects/[id]/layout.tsx` — remove tab navigation, add project sidebar
- Remove horizontal tab navigation from project layout

## 3. Base Component Polish

### Button

- Remove heavy box-shadow
- Hover: subtle background shift + 150ms transition
- Active: slight scale(0.98) for press feedback
- Default variant: border 1px, background transparent (light) / rgba(255,255,255,0.06) (dark)
- Primary variant: solid background, lighter font weight (medium not bold)

### Card

- Border: 1px `var(--border)`
- Background: `var(--background-secondary)` or transparent depending on context
- Hover (when clickable): border shifts to `var(--border-hover)`, subtle shadow
- Border radius: 12px
- No distinct background color difference from page — rely on border for separation

### Input

- Border: 1px `var(--border)`
- Focus: thin ring (2px) using primary color at low opacity, not thick border change
- Border radius: 8px
- Height: 36px
- Font size: 13px

### Badge

- Smaller, lighter: font-size 12px, padding 2px 8px, border-radius 6px
- Subtle background, no bold colors for non-destructive variants

### Dialog

- Backdrop: `rgba(0,0,0,0.5)` with `backdrop-filter: blur(4px)`
- Border: 1px `var(--border)`, radius 12px
- Smooth enter/exit transitions

### Status indicators

- Unified: 8px circle + glow box-shadow
- Colors: ready (green), building (amber), error (red), stopped (gray)
- Replace current Badge-based status display with dot + text

## 4. Page-Level Refinements

### Dashboard (project list)

- Project cards: low-opacity border, hover border brightens + subtle shadow elevation
- Status: 8px dot with glow, no Badge
- Last deploy info: muted color, small font
- Empty state: centered, well-designed with CTA button

### Deployments list

- Switch from card layout to minimal list/table
- No zebra stripes, rows separated by 1px low-opacity borders
- Hover: entire row highlights (4% background)
- Version/commit in monospace
- Status: dot + text
- Time: relative format ("2m ago")

### Deployment detail

- Stage progress sidebar: connected with thin vertical line, circular status icons per stage
- xterm terminal: keep dark theme, unify border-radius to 12px, consistent border

### Pipeline editor

- Drag cards: thinner borders, drag state adds subtle shadow elevation
- Stage config dialog: refined Dialog styling

### Database / Redis / Storage

- Left panel (table/key/bucket list): no background difference, active item uses subtle highlight
- SQL/Redis terminal areas: dark theme preserved, 12px border-radius, consistent borders
- Data tables: Vercel-style minimal — no zebra, thin separators, sticky header with subtle background
- File browser: simplified breadcrumb navigation

### Settings / Team / Domains

- Form layout: increased spacing between label + input, clear grouping
- Card-based sections, one card per functional group
- Danger zone: red-bordered card section for destructive actions

### Project creation wizard

- Steps indicator refined to minimal dots/line progress
- Each step card-styled with clear section hierarchy

## 5. Global Micro-interactions

- All transitions: 150ms ease
- Loading states: skeleton screens instead of spinners where applicable
- Toast (sonner): style aligned with new design tokens — border, radius, colors
- Smooth page transitions via Next.js loading states

## 6. Files Overview

### New files

- `components/top-nav.tsx`
- `components/project-sidebar.tsx`

### Modified files (styling/structure)

- `app/globals.css` — new color tokens, typography scale, transition defaults
- `app/(app)/layout.tsx` — top nav layout
- `app/projects/[id]/layout.tsx` — project sidebar, remove tabs
- `components/ui/button.tsx` — styling refinements
- `components/ui/card.tsx` — border/radius updates
- `components/ui/input.tsx` — focus ring
- `components/ui/badge.tsx` — lighter styling
- `components/ui/dialog.tsx` — backdrop blur, transitions
- `components/project-card.tsx` — new card design + status dot
- `components/stage-progress.tsx` — connected line + circle icons
- `components/deploy-log-viewer.tsx` — border/radius alignment
- `components/env-var-editor.tsx` — form spacing
- `components/pipeline-editor.tsx` — drag card polish
- `components/sql-query-panel.tsx` — terminal styling alignment
- `components/redis-cli-panel.tsx` — terminal styling alignment
- All page files under `app/` — spacing, component usage, status display updates

### Deleted files

- `components/app-sidebar.tsx` — replaced by top-nav + project-sidebar
