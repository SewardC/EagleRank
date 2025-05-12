# EagleRank Web UI Wireframes — Figma Prompt

## Project Context
EagleRank is a real-time, multi-tenant feed ranking system. The Web UI is an internal tool for engineers, admins, and tenant developers to visualize, debug, and test the feed ranking pipeline. The UI should be clean, modern, and highly functional, with a focus on transparency, data inspection, and system health.

---

## General Design Guidelines
- Dashboard layout with sidebar or top navigation for main sections
- Prioritize clarity, data density, and ease of debugging
- Tailwind-style spacing, clear typography, subtle color accents
- Responsive for desktop and tablet
- Space for status indicators, error messages, and loading states

---

## Main Components to Include

### 1. Header / Navigation
- EagleRank logo and environment indicator (e.g., “Dev”, “Prod”)
- User/account menu (login/logout, role display)
- Quick links to documentation and Grafana dashboards

### 2. Sidebar Navigation (or Topbar)
- Sections:
  - Feed Explorer
  - Feature Explorer
  - System Metrics
  - Tenant Management
  - (Optional) Settings

### 3. Feed Explorer
- Tenant Switcher: Dropdown to select active tenant
- User ID Input: Text field or dropdown to select/test a user
- Get Feed Button: Triggers API call to fetch ranked feed
- Feed Results Table/List:
  - Columns: Rank, Item ID, Author, Score, Title/Content snippet
  - Each row expandable to show:
    - Feature values used for ranking (e.g., user_click_rate, item_age_hours)
    - Model score breakdown (if available)
    - Debug info (raw feature vector, model version)
- Filters/Controls:
  - Filter by content type, author, or score range
  - Slider/toggle to simulate different ranking algorithms or parameters (e.g., recency vs. relevance)
- Loading and Error States: Spinners, error banners, retry options

### 4. Feature Explorer
- Entity Type Selector: User or Item
- ID Input: Enter user ID or item ID
- Query Button: Fetches and displays all features for the entity
- Feature Table:
  - Columns: Feature Name, Value, Source (real-time/batch), Description
  - Highlight missing or anomalous values
- Export/Copy Option: Button to copy feature data for debugging

### 5. System Metrics
- Grafana Dashboard Embeds or Links: Show key metrics (QPS, latency, error rate, Kafka lag, etc.)
- Status Cards: For each microservice (Gateway, Candidate, Ranker, Flink, Redis, Kafka), show health, uptime, and key stats
- Alerts/Notifications: Display active alerts or recent incidents

### 6. Tenant Management
- Tenant List/Table: Show all tenants, status (active/inactive), and key config (model version, feature flags)
- Tenant Detail View: Show/edit tenant-specific settings (e.g., ranking model, business rules)
- Add/Edit Tenant Modal: For admin users

### 7. Authentication & Security
- Login Modal/Page: Simple login (username/password or OAuth)
- Role Display: Show current user's role (platform admin, tenant admin, user)
- Access Control: Only show features allowed by role

### 8. General UI Elements
- Global Search (optional): Search for users, items, or tenants
- Breadcrumbs: For navigation context
- Help/Docs Button: Quick access to documentation
- Theme Toggle: Light/dark mode switch (optional)

---

## Visual Style
- Clean, modern, and professional (developer dashboard style)
- Subtle color coding for status (green = healthy, yellow = warning, red = error)
- Monospace font for IDs, feature vectors, and code-like data
- Use cards, tables, and expandable panels for data presentation

---

## User Flows to Support
- Admin logs in, selects a tenant, enters a user ID, and views their ranked feed
- Admin expands a feed item to debug feature values and model scores
- Admin queries feature store for a user or item and inspects all features
- Admin views system health and metrics, responds to alerts
- Admin manages tenants and configures per-tenant settings

---

**End of prompt.**

*Generate wireframes for each section, showing realistic data and interactions. Prioritize clarity, transparency, and developer usability.* 