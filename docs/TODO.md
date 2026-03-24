# BubblyChef TODO & Roadmap

**Last Updated:** 2026-03-24

This document tracks current tasks, bugs, and future enhancements. See [docs/ROADMAP.md](ROADMAP.md) for the long-term product vision.

---

## ✅ Completed

### Phase 1 (Foundation + Core Features)
- [x] Backend pantry CRUD API
- [x] Frontend pantry management UI
- [x] Receipt scanning with Tesseract OCR
- [x] AI-powered receipt parsing (Gemini)
- [x] Receipt review & confirmation flow
- [x] Comprehensive logging system
- [x] Recipe generation API + UI
- [x] Pantry-grounded AI prompting

### Phase 2 — Dashboard + Chat
- [x] Dashboard page with expiring widget + quick actions
- [x] Desktop sidebar layout
- [x] Chat backend (`POST /v1/chat`) with intent classification workflow
- [x] Chat page (`/chat`) with message thread + sticky input
- [x] Frontend connected to `POST /v1/chat`
- [x] Intent-specific response rendering (pantry proposal, recipe card, plain text)
- [x] Recent Activity widget pulls real pantry data
- [x] Proposal approval wired to DB
- [x] Conversation history (backend + frontend)

### Phase K1 — Fluent Emoji Icon System
- [x] 304-entry food catalog (`bubbly_chef/domain/pantry_catalog.json`)
- [x] `GET /api/icons/{name}` with category fallback
- [x] Pantry grid uses icon API
- [x] HF background generation removed

### Phase K2B — DOM Kitchen Scene
- [x] DOM-based kitchen room + interior views
- [x] Drag-and-drop item placement (HTML5 native, slot_index persisted)
- [x] Cross-zone drag between fridge/freezer/pantry/counter
- [x] Milestone progress bar + decoration unlock system
- [x] Phaser dependency removed

---

## 🚧 Active / Next Up

### Backend
- [ ] Add pagination to pantry list endpoint
- [ ] Unit conversion system (dozen eggs → individual eggs)
- [ ] Database migrations (Alembic)
- [ ] Rate limiting for AI provider calls

### Frontend
- [ ] Markdown rendering in chat bubbles (`react-markdown`)
- [ ] End-to-end testing (Playwright)
- [ ] Accessibility improvements (ARIA labels, keyboard nav)

---

## 🐛 Known Bugs

### High Priority
- [ ] Receipt parsing sometimes confuses prices with quantities
- [ ] Long item names overflow in mobile view
- [ ] Expiry date estimation for produce can be inaccurate

### Low Priority
- [ ] Bottom nav doesn't stay fixed on iOS Safari
- [ ] Some emojis don't render on older devices

---

## 🔮 Future Phases

### Phase 3: Recipe Library + Multimodal Ingestion (Q2–Q3 2026)
- [ ] Recipe CRUD — save, edit, delete, search recipes
- [ ] Shopping list from missing ingredients
- [ ] URL ingestion — scrape recipe websites
- [ ] Short-form video ingestion (TikTok, Reels, YouTube Shorts)
- [ ] Long-form video ingestion (YouTube)
- [ ] Recipe index with source badges (🎵 TikTok, 📺 YouTube, 🔗 URL, ✨ AI)
- [ ] Saved-recipe-lookup chat intent

### Phase 4: Mobile PWA (Q4 2026)
- [ ] Progressive Web App (PWA) setup
- [ ] Offline support
- [ ] Push notifications for expiring items
- [ ] Camera integration for receipt scanning

### Phase 5: Advanced Features (2027+)
- [ ] User accounts and authentication
- [ ] Meal planning calendar
- [ ] Multi-user/household support

---

## 📝 Decision Log

- **2026-03-24**: Replaced Phaser (K2) with DOM-native kitchen scene (K2B) — simpler, no canvas library conflicts
- **2026-03-17**: Built 304-entry USDA-backed food catalog for icons + categorization (K1)
- **2026-03-17**: Rewrote expiry.py with `dry_goods`/`canned` keys, dropped stale `pantry` key
- **2026-03-16**: Chat clarified as intent router — intents: recipe-generate, pantry-add, cooking-question, saved-recipe-lookup
- **2026-03-16**: Pushed recipe-save + shopping-list to Phase 3; redefined Phase 3 as multimodal recipe ingestion


This document tracks current tasks, bugs, and future enhancements. See [docs/plans/roadmap.md](plans/roadmap.md) for the long-term product vision.

---

## 🎯 Current Sprint (Phase 2 - Dashboard + Chat)

### ✅ Completed (Phase 1B)
- [x] Backend pantry CRUD API
- [x] Frontend pantry management UI
- [x] Receipt scanning with Tesseract OCR
- [x] AI-powered receipt parsing (Gemini)
- [x] Receipt review & confirmation flow
- [x] Comprehensive logging system
- [x] Project reorganization and documentation cleanup

### ✅ Completed (Phase 1C)
- [x] Recipe generation API endpoint (`POST /api/recipes/generate`)
- [x] Pantry-grounded AI prompting (includes pantry context and expiring items)
- [x] Recipe response with ingredient availability (have/partial/missing)
- [x] Recipe suggestions endpoint (`GET /api/recipes/suggestions`)
- [x] Recipe input UI with prompt and suggestions
- [x] Recipe display with ingredient status indicators
- [x] Session-based follow-up support ("make it spicier")

### ✅ Completed (Phase 2 — partial)
- [x] Dashboard page with expiring widget + quick actions
- [x] Desktop sidebar layout
- [x] Chat backend (`POST /v1/chat`) with intent classification workflow
- [x] Workflow resumption system (`POST /v1/workflows/{id}/events`)
- [x] Chat page (`/chat`) with message thread + sticky input
- [x] Nav link to chat (sidebar + bottom nav)
- [x] Frontend connected to `POST /v1/chat`
- [x] Intent-specific response rendering (pantry proposal, recipe card, plain text, saved-recipe placeholder)
- [x] Recent Activity widget pulls real pantry data

---

## 🚧 In Progress (Phase 2 remaining)

### Known Gaps from Chat UI implementation
- [ ] **Pantry-add approval doesn't write to DB** — Approve button shows local "Added!" only; needs to call `POST /v1/workflows/{id}/events` with `{event_type: "submit_review", decision: "approve"}` to actually persist
- [ ] **No conversation persistence** — chat messages live in React state only, cleared on refresh; Phase 3 candidate for SQLite persistence
- [ ] **BottomNav 6-item crowding** — now has 6 nav items; may be tight on narrow screens (< 320px), consider hiding labels on non-active items
- [ ] **Markdown rendering in chat** — AI responses may contain markdown (bold, lists, code, headers); chat bubble renderer needs to parse and style `.md` syntax (e.g. use `react-markdown` or similar)

### Backend Improvements
- [ ] Add pagination to pantry list endpoint
- [ ] Add bulk operations (delete multiple, update multiple)
- [ ] Improve AI prompt for better receipt parsing accuracy
- [ ] Add retry logic for AI provider failures
- [ ] **Product catalog system with icons**
  - Problem: Items like "bananas" show wrong emoji (🥬 lettuce instead of 🍌)
  - Need: Baseline product catalog with curated name → emoji mappings
  - Features: Common product database, fuzzy matching, category-appropriate fallbacks
  - Format: JSON/YAML catalog with canonical names + metadata (emoji, alt names, category)
  - Consider: User-editable product library, learn from corrections
- [ ] **Unit conversion system for recipe consumption**
  - Problem: Pantry tracks "1 dozen eggs" but recipes use "3 eggs"
  - Need conversion logic: dozen → individual eggs, gallon → cups, lb → oz
  - Options: Simple conversion table, dual-unit tracking, or manual adjustment
  - Affects recipe-to-pantry deduction feature

---

## 🐛 Known Bugs

### High Priority
- [ ] Receipt parsing sometimes confuses prices with quantities
- [ ] Long item names overflow in mobile view
- [ ] Expiry date estimation for produce can be inaccurate

### Low Priority
- [ ] Bottom nav doesn't stay fixed on iOS Safari
- [ ] Some emojis don't render on older devices
- [ ] Console warnings in development mode

---

## 🔮 Future Phases

### Phase 3: Recipe Library + Multimodal Ingestion (Q2–Q3 2026)

The goal: save recipes from any source and surface them via chat. "Remember that matcha lemonade TikTok?" should work.

- [ ] **Recipe CRUD** — save, edit, delete, search AI-generated recipes
- [ ] **Shopping list** — generate missing ingredient list from any saved recipe
- [ ] **URL ingestion** — scrape recipe websites, extract structured recipe
- [ ] **Short-form video ingestion** (TikTok, Instagram Reels, YouTube Shorts)
  - [ ] Video download + transcription pipeline (Whisper / AssemblyAI)
  - [ ] AI extraction: ingredients, steps, metadata from transcript + frames
  - [ ] Thumbnail + source metadata storage
- [ ] **Long-form video ingestion** (YouTube)
  - [ ] Same pipeline, timestamp-aware step extraction
- [ ] **Recipe index** — unified search across all sources with source badges
- [ ] **Saved-recipe-lookup intent** — chat surfaces saved recipes by name/description
- [ ] **Side dish generation** — after main recipe, offer pantry-grounded side dishes
- [ ] Better OCR accuracy for receipts
- [ ] Ollama self-hosted AI support

### Phase 4: Mobile PWA (Q4 2026)
- [ ] Progressive Web App (PWA) setup
- [ ] Offline support
- [ ] Push notifications for expiring items
- [ ] Camera integration for receipt scanning
- [ ] Barcode scanning for products

### Phase 5: Advanced Features (2027+)
- [ ] User accounts and authentication
- [ ] Meal planning calendar
- [ ] Multi-user/household support

---

## 🔧 Technical Debt

### Backend
- [ ] Add database migrations system (Alembic)
- [ ] Implement proper error handling with custom exceptions
- [ ] Add rate limiting for AI provider calls
- [ ] Set up Redis for caching and sessions
- [ ] Add API versioning (/v1/, /v2/)
- [ ] Implement proper authentication/authorization

### Frontend
- [ ] Set up end-to-end testing (Playwright/Cypress)
- [ ] Add accessibility improvements (ARIA labels, keyboard nav)
- [ ] Optimize bundle size
- [ ] Add service worker for offline support
- [ ] Implement proper error tracking (Sentry)

### DevOps
- [ ] Set up CI/CD pipeline
- [ ] Deployment scripts for production
- [ ] Monitoring and alerting
- [ ] Automated backups

### Documentation
- [ ] API reference with OpenAPI/Swagger
- [ ] Component storybook
- [ ] Video tutorials for common tasks
- [ ] Contributing guidelines
- [ ] Code of conduct

---

## 💡 Ideas & Enhancements

### UX Improvements
- [ ] Drag-and-drop to organize pantry items
- [ ] Custom categories and tags
- [ ] Pantry sharing (QR code/link)
- [ ] Print shopping list
- [ ] Voice input for adding items
- [ ] Dark mode
- [ ] **Unit system overhaul**
  - Purchase units vs consumption units (dozen vs individual eggs)
  - Unit dropdown instead of free text
  - Preset units per category (dairy: gallon/quart/pint, produce: lb/oz/bunch)
  - Unit conversion for recipe integration

### AI Enhancements
- [ ] Multi-language support for receipts
- [ ] Better handling of store-specific formats
- [ ] Learn from user corrections
- [ ] Dietary preferences and restrictions
- [ ] Allergen warnings
- [ ] **Video recipe parsing improvements**
  - [ ] Multi-language video transcription
  - [ ] Visual ingredient detection from video frames
  - [ ] Cooking technique recognition
  - [ ] Auto-tagging (cuisine, difficulty, dietary tags)
  - [ ] Ingredient quantity estimation from visual cues

### Integrations
- [ ] **Video platform APIs** (Phase 3)
  - [ ] TikTok API for metadata and video access
  - [ ] Instagram Graph API for Reels
  - [ ] YouTube Data API v3 for Shorts
  - [ ] Video transcription services (Whisper, Rev.ai, AssemblyAI)

---

## 📊 Metrics & Goals

### User Metrics (Target)
- Active users: 100+ by end of Q2
- Daily active users: 30+ by end of Q2
- Receipts scanned: 500+ by end of Q2
- Recipes saved: 200+ by end of Q2

### Technical Metrics
- API response time: < 200ms (p95)
- Frontend bundle size: < 300KB gzipped
- Test coverage: > 80%
- Lighthouse score: > 90

---

## 🎓 Learning & Research

### To Investigate
- [ ] Better OCR alternatives (Google Cloud Vision, AWS Textract)
- [ ] Barcode scanning libraries
- [ ] Recipe scraping best practices
- [ ] Nutrition data APIs
- [ ] Food safety guidelines and expiry data
- [ ] **Video processing technologies**
  - [ ] Video transcription APIs (cost, accuracy, language support)
  - [ ] Computer vision for ingredient detection (YOLO, CLIP)
  - [ ] TikTok/Instagram API access and limitations
  - [ ] YouTube Shorts vs regular videos API differences
  - [ ] Video storage solutions (local, S3, CDN)
  - [ ] Video frame extraction libraries (ffmpeg, opencv)
  - [ ] Copyright and fair use considerations for saved videos

### Performance Optimization
- [ ] Database query optimization
- [ ] AI prompt caching
- [ ] Image optimization for receipts
- [ ] Frontend code splitting

---

## 📝 Notes

### Decision Log
- **2026-03-16**: Pushed recipe-save + shopping-list to Phase 3; redefined Phase 3 as multimodal recipe ingestion (URL, TikTok, Reels, YouTube)
- **2026-03-16**: Chat clarified as natural language intent router, not grocery conversation — intents: recipe-generate, pantry-add, cooking-question, saved-recipe-lookup
- **2026-03-06**: Reorganized project structure, moved all docs to `docs/`
- **2026-03-06**: Added comprehensive logging system with colored output
- **2026-03-06**: Changed backend port from 8000 to 9000
- **2026-02-17**: Implemented receipt scanning with Tesseract OCR
- **2026-02-17**: Integrated Gemini AI for receipt parsing

### Deferred Features
- Shopping list sync with grocery stores (too complex for MVP)
- Barcode scanning (not enough value vs effort for Phase 1)
- ~~Recipe video integration~~ → PROMOTED to Phase 3 (major feature)
- Video downloading/hosting (Phase 3 - will link to original URLs first, local storage later)

---

## 🤝 Contributing

Want to help? Pick a task from the "In Progress" section or tackle a known bug! See the main [README.md](../README.md) for setup instructions.

For questions or suggestions, open an issue or start a discussion.
