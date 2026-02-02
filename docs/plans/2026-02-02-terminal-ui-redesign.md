# Terminal/Hacker UI Redesign

**Date**: 2026-02-02
**Status**: Approved for implementation

## Problem Statement

The current UI has several readability issues:
- Text contrast is too low
- Colors feel muddy/washed out (purple glass-morphism)
- Too much visual noise from glass effects and gradients
- Data values are hard to scan quickly

## Design Direction

**Terminal/Hacker aesthetic** with:
- Pure black backgrounds for maximum contrast
- Matrix green (`#00FF41`) and cyan (`#00D4FF`) accent colors
- Full monospace typography (JetBrains Mono)
- Glow effects on hover only (minimal visual noise)
- High-contrast light mode alternative

## Color System

### Dark Mode (Primary)

| Role | Hex | RGB |
|------|-----|-----|
| Background | `#000000` | `0 0 0` |
| Surface | `#0D0D0D` | `13 13 13` |
| Surface Elevated | `#141414` | `20 20 20` |
| Surface Hover | `#1A1A1A` | `26 26 26` |
| Text Primary | `#E0E0E0` | `224 224 224` |
| Text Bright | `#FFFFFF` | `255 255 255` |
| Text Muted | `#666666` | `102 102 102` |
| Accent (Green) | `#00FF41` | `0 255 65` |
| Accent (Cyan) | `#00D4FF` | `0 212 255` |
| Warning | `#FFB800` | `255 184 0` |
| Danger | `#FF3B3B` | `255 59 59` |

### Light Mode

| Role | Hex |
|------|-----|
| Background | `#FFFFFF` |
| Surface | `#FAFAFA` |
| Text Primary | `#0A0A0A` |
| Accent (Green) | `#008F35` |
| Accent (Cyan) | `#00A0C8` |

## Typography

- **Font**: JetBrains Mono (Google Fonts)
- **Weights**: 400 (body), 500 (data), 600 (headings)
- **Features**: Tabular figures for number alignment

### Type Scale

| Element | Size | Weight |
|---------|------|--------|
| Page title | 24px | 600 |
| Section header | 18px | 600 |
| Card title | 14px | 500 |
| Body/labels | 13px | 400 |
| Large values | 28px | 600 |
| Table data | 13px | 500 |
| Muted text | 12px | 400 |

## Component Patterns

### Cards
- Background: `#0D0D0D`
- Border: 1px solid `#00FF41` at 15% opacity
- Border radius: 6px
- 2px accent bar at top
- Hover: border 35% opacity + subtle glow

### Tables
- Header: elevated background, muted uppercase text
- Rows: alternating subtle backgrounds
- Hover: row highlight + left border accent

### Buttons
- Surface background with accent border
- Hover: glow effect + text color change

### Charts
- Transparent background (uses page black)
- Very subtle green grid lines
- Green/cyan series colors
- Dotted crosshair

## Files Affected

- `tailwind.config.ts`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/components/Nav.tsx`
- `src/components/ThemeToggle.tsx`
- `src/components/charts/*.tsx`
- `src/components/blocks/*.tsx`
- `src/app/page.tsx`
- `src/app/analytics/page.tsx`
- `src/app/status/page.tsx`
