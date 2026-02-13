# Animation & Charts Guide

## Packages

| Package | Purpose |
|---------|---------|
| `motion` | Page transitions, stagger animations, hover effects (framer-motion v11+) |
| `@nivo/core` `@nivo/line` `@nivo/bar` `@nivo/pie` | Charts — replaced Recharts |

## Animation Components

All exported from `components/ui/motion.tsx` and re-exported via `components/ui/index.ts`.

### `<AnimatedPage>`

Wraps page content. Replaces the old CSS `.fade-in` class.

```tsx
<AnimatedPage className="max-w-7xl mx-auto space-y-6">
  {/* page content */}
</AnimatedPage>
```

### `<AnimatedStagger>` + `<AnimatedItem>`

Staggered entrance for lists and grids. Children appear one by one.

```tsx
<AnimatedStagger className="grid grid-cols-4 gap-4" delay={0.06}>
  {items.map(item => (
    <AnimatedItem key={item.id}>
      <div>...</div>
    </AnimatedItem>
  ))}
</AnimatedStagger>
```

### `<AnimatedCard>`

Stat card with stagger entrance + hover lift/glow. Use inside `<AnimatedStagger>`.

```tsx
<AnimatedStagger className="grid grid-cols-4 gap-4">
  {stats.map(stat => (
    <AnimatedCard key={stat.label}>
      <div className="flex items-start justify-between">...</div>
    </AnimatedCard>
  ))}
</AnimatedStagger>
```

**Note:** Do NOT add `hover:shadow-2xl hover:-translate-y-0.5` — AnimatedCard handles hover via Motion.

### `<AnimatedTableBody>` + `<AnimatedTableRow>`

Drop-in replacements for `<tbody>` and `<tr>` with staggered row entrance.

```tsx
<table>
  <thead>...</thead>
  <AnimatedTableBody>
    {rows.map(row => (
      <AnimatedTableRow key={row.id} className="border-b border-border">
        <td>...</td>
      </AnimatedTableRow>
    ))}
  </AnimatedTableBody>
</table>
```

### `<ContentTransition>`

Crossfade between loading skeleton and content.

```tsx
<ContentTransition
  isLoading={isLoading}
  loadingContent={<Skeleton />}
>
  <ActualContent />
</ContentTransition>
```

### Re-exports

`motion`, `AnimatePresence`, and variant objects (`fadeSlideUp`, `fadeIn`, `scaleIn`) are re-exported for custom usage.

## Charts (Nivo)

### Theme

```tsx
import { getNivoTheme } from '../../lib/nivo-theme';

const nivoTheme = useMemo(() => getNivoTheme(), []);

<ResponsiveLine theme={nivoTheme} ... />
```

`getNivoTheme()` reads CSS custom properties so it syncs with dark/light mode.

### Tooltip

Use the shared `ChartTooltip` + `TooltipLine` instead of Nivo's default tooltip:

```tsx
import { ChartTooltip, TooltipLine } from '../../components/ui/chart-tooltip';

tooltip={({ point }) => (
  <ChartTooltip>
    <TooltipLine label="Ventas" value="$1,234" sub="12 pedidos" color="#22c55e" />
  </ChartTooltip>
)}
```

### Color palette

```ts
import { CHART_COLORS } from '../../lib/nivo-theme';
// ['hsl(var(--primary))', '#22c55e', '#38bdf8', '#f59e0b', '#ef4444', ...]
```

## Rules

1. **Every page** wraps its main content in `<AnimatedPage>`
2. **Stat card grids** use `<AnimatedStagger>` + `<AnimatedCard>`
3. **Table data rows** use `<AnimatedTableBody>` + `<AnimatedTableRow>` (header rows stay as `<tr>`)
4. **Lists** use `<AnimatedStagger>` + `<AnimatedItem>`
5. **Do NOT animate** Dialog, Sheet, Select, DropdownMenu — Radix handles those via `tailwindcss-animate`
6. **Page transitions** are handled by `DashboardLayout` and `AdminLayout` via `<AnimatePresence>` on `<Outlet />`
7. **Never use** the old `.fade-in` CSS class — it has been removed
