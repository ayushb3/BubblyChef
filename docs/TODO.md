# BubblyChef TODO & Roadmap

**Last Updated:** 2026-03-08

This document tracks current tasks, bugs, and future enhancements. See [docs/plans/roadmap.md](plans/roadmap.md) for the long-term product vision.

---

## 🎯 Current Sprint (Phase 1C - Recipe Generation)

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

---

## 🚧 In Progress

### Frontend Polish
- [ ] Loading states and skeleton screens
- [ ] Error boundary and error handling UI
- [ ] Empty states with illustrations
- [ ] Toast notifications for actions
- [ ] Mobile responsiveness improvements
- [ ] **Desktop layout optimization**
  - Problem: On desktop, content is vertically contained like mobile with lots of horizontal whitespace
  - Consider: Grid layout (2-3 columns), sidebar navigation, wider max-width
  - Explore: Multi-column card grid, split view (list + detail), dashboard widgets

### Backend Improvements
- [ ] Add pagination to pantry list endpoint
- [ ] Implement search highlighting
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

## 📋 Next Phase: Phase 1C - Recipes

### Phase 1C: Remaining Tasks
- [ ] **Recipe CRUD for saving recipes**
  - Save AI-generated recipes
  - Save imported recipes (URL, video, manual)
  - Edit saved recipes
  - Delete recipes
  - Recipe collections/folders
- [ ] Recipe list and detail pages
- [ ] Recipe search and filtering
- [ ] Recipe to shopping list converter
- [ ] **Recipe consumption tracking**
  - Deduct ingredients from pantry when cooking
  - Handle unit conversions (dozen eggs → individual eggs)
  - Partial consumption support (use 2 of 4 chicken breasts)
  - History of cooked recipes

### AI Features
- [ ] Recipe extraction from URL (scraping traditional websites)
- [ ] Recipe import from text/photo
- [ ] Recipe suggestions based on pantry contents
- [ ] Ingredient substitution recommendations

---

## 🔮 Future Phases

### Phase 2: Dashboard & Chat (Q2 2026)
- [ ] Dashboard home page with insights
- [ ] Chat interface for natural language interactions
- [ ] Intent router for chat commands
- [ ] "I bought milk and eggs" → auto-add to pantry
- [ ] "What should I cook tonight?" → recipe suggestions
- [ ] **Chat-recipe integration**
  - Chat can access saved recipe library
  - Reference recipes by name ("that butter chicken recipe")
  - Suggest saved recipes matching pantry
  - "Make that TikTok recipe I saved" → retrieve and display
- [ ] Shopping list generation from recipes

### Phase 3: Recipe Library + Video Ingestion (Q3 2026)
- [ ] Recipe collections and organization
- [ ] Recipe search across all sources (generated, video, URL, manual)
- [ ] **Video recipe ingestion system (MAJOR FEATURE)**
  - [ ] TikTok API/parser integration
  - [ ] Instagram Reels parser
  - [ ] YouTube Shorts parser (YouTube Data API v3)
  - [ ] Video download and processing pipeline
  - [ ] Video transcription service (Whisper API, Rev.ai, or AssemblyAI)
  - [ ] AI extraction of ingredients from transcription + video frames
  - [ ] AI extraction of cooking steps with timestamps
  - [ ] Thumbnail generation and storage
  - [ ] Video metadata indexing (creator, duration, hashtags, caption)
  - [ ] Link video recipes to pantry matching
  - [ ] "Saved from TikTok" badge/indicator in UI
- [ ] Better OCR accuracy for receipts
- [ ] Ollama self-hosted AI support

### Phase 4: Mobile PWA + Social (Q4 2026)
- [ ] Progressive Web App (PWA) setup
- [ ] Offline support
- [ ] Push notifications for expiring items
- [ ] Camera integration for receipt scanning
- [ ] **In-app video playback for saved recipes**
- [ ] Share recipes with friends
- [ ] Video recipe commenting and ratings
- [ ] Barcode scanning for products

### Phase 5: Advanced Features (2027+)
- [ ] User accounts and authentication
- [ ] Meal planning calendar
- [ ] Nutrition tracking
- [ ] Multi-user/household support
- [ ] Social recipe sharing with video embeds
- [ ] Recipe remix feature (edit video recipes)

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
- [ ] Google Calendar integration for meal planning
- [ ] Grocery delivery APIs (Instacart, Amazon Fresh)
- [ ] Smart home integration (Alexa, Google Home)
- [ ] Fitness apps (MyFitnessPal)
- [ ] Recipe APIs (Spoonacular, Edamam)
- [ ] **Video platform APIs**
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
