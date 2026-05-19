# crm-live-dashboard

> A real-time sales pipeline dashboard built as a native module.  
> Live data. Clickable KPIs. Team performance breakdown. No page refresh needed.

Part of the [enterprise-ai-agent](../enterprise-ai-agent) project — built by giving an AI agent plain English instructions and letting the WAT framework handle the rest.

---

## What it does

Replaces the default pipeline view with a live dashboard that auto-refreshes every 30 seconds and responds to WebSocket push events in real time.

**KPI cards** — Total opportunities, stuck deals, won, lost, and pipeline value. Each card is clickable and drills through to the underlying records.

**Pipeline funnel** — Visual bar chart of deal counts per stage. Click any stage to open filtered opportunities.

**Team breakdown table** — Per-salesperson view showing assigned deals, deals advanced, won, lost, win rate, and average days to move. Each cell is clickable.

**Lost reasons analysis** — Bar chart of loss reasons with percentage breakdown. Click any reason to see the underlying deals.

**Activity feed** — Last 15 stage movements with timestamps and salesperson names.

**Inactive salesperson detection** — Highlights team members with zero activity in the selected period.

**Date filters** — Today, Yesterday, Last Week, Last Month, or custom date range. Salesperson filter to focus on individual reps.

**Share report** — One-click email composition with a formatted HTML summary of the current view.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | OWL (Odoo Web Library) — component-based reactive UI |
| Charts | Chart.js (bar charts) |
| Data | ORM service via `useService("orm")` — no custom Python models |
| Live updates | Bus service (`useService("bus_service")`) + 30s polling fallback |
| Styles | Custom CSS with CSS variables for theme compatibility |

---

## Compatibility

- **Platform version**: 18.0
- **Depends on**: `crm`, `web`
- **No Python models** — pure frontend, reads directly from `crm.lead` via ORM

---

## Installation

1. Copy the `crm_live_dashboard` folder into your addons directory
2. Update your addons list (Settings → Technical → Update Apps List, or restart with `-u all`)
3. Install **CRM Live Dashboard** from the Apps menu
4. Navigate to CRM → Live Dashboard

---

## File structure

```
crm_live_dashboard/
├── __init__.py
├── __manifest__.py
├── views/
│   └── menu.xml              # Adds "Live Dashboard" to CRM menu
└── static/src/
    ├── js/
    │   └── dashboard.js      # Main OWL component (~500 lines)
    ├── css/
    │   └── dashboard.css     # Styles and responsive layout
    └── xml/
        └── dashboard.xml     # OWL templates (KPIs, funnel, tables, feed)
```

---

## How it was built

This module was built using the [enterprise-ai-agent](../enterprise-ai-agent) framework. The instruction given was roughly:

> "Build a live CRM dashboard that shows pipeline KPIs, a funnel by stage, team performance per salesperson, lost reason analysis, and an activity feed. It should auto-refresh and let me click through to the underlying records."

The agent read the `create_module` workflow, scaffolded the structure, and iteratively built and corrected the OWL component — handling the Chart.js integration, bus service subscription, date range logic, and clickable navigation — until the module installed and ran correctly.

---

## Screenshots

*(Add screenshots here after installation)*

---

## License

LGPL-3 — same as the platform it extends.
