# BubblyChef Frontend

A cute, Sanrio-inspired React frontend for the BubblyChef pantry and recipe app.

## 🎨 Design System

### Colors
- **Pastel Pink** (#FFB5C5) - Primary actions, highlights
- **Pastel Mint** (#B5EAD7) - Success states, safe items
- **Pastel Lavender** (#C9B5E8) - Recipe features
- **Pastel Peach** (#FFDAB3) - Warning states (expiring soon)
- **Pastel Coral** (#FF9AA2) - Danger states (expired)
- **Cream** (#FFF9F5) - Background
- **Soft Charcoal** (#4A4A4A) - Text

### Typography
- **Font**: Nunito (from Google Fonts)
- Rounded, friendly appearance

### Components
- **Rounded corners**: 12-24px radius
- **Shadows**: Soft, warm-toned
- **Icons**: Lucide React (rounded style)
- **Emojis**: Used throughout for visual delight

## 🚀 Getting Started

### Prerequisites
- Node.js 20.x
- Backend running at `http://localhost:9000`

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Building for Production

```bash
npm run build
npm run preview
```

## 📁 Project Structure

```
web/
├── src/
│   ├── api/           # API client & React Query hooks
│   ├── components/    # Reusable UI components
│   │   ├── AddItemModal.tsx
│   │   ├── BottomNav.tsx
│   │   └── Layout.tsx
│   ├── pages/         # Page components
│   │   ├── Dashboard.tsx
│   │   ├── Pantry.tsx
│   │   ├── Scan.tsx
│   │   └── Recipes.tsx
│   ├── types/         # TypeScript type definitions
│   ├── App.tsx        # Main app with routing
│   └── main.tsx       # Entry point
├── v0-designs/        # Exported v0.dev components (for comparison)
└── tailwind.config.js # Tailwind configuration
```

## 🎯 Features

### ✅ Completed (Phase 1A)
- **Dashboard**: Home page with expiring items, quick actions
- **Pantry List**: View all items with filtering by location
- **Add/Edit Items**: Modal form for CRUD operations
- **Bottom Navigation**: Floating nav bar with 4 main sections
- **API Integration**: Full CRUD with React Query
- **Responsive Design**: Mobile-first, optimized for 375-480px

### 🚧 Coming Soon
- **Scan Receipt** (Phase 1B): OCR receipt scanning
- **Recipe Generator** (Phase 2): AI-powered recipe suggestions
- **Chat Interface** (Phase 2): Conversational AI assistant

## 🛠️ Tech Stack

- **React 18** + TypeScript
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Query** - Server state management
- **React Router v6** - Routing
- **Lucide React** - Icons
- **Zustand** - Local state (planned)

## 🎨 Design Philosophy

The frontend embraces a **kawaii/Sanrio aesthetic**:
- Soft pastel colors throughout
- Rounded corners on all components
- Liberal use of food emojis
- Friendly, approachable interface
- Subtle animations and transitions
- Mobile-first responsive design

## 🔗 API Integration

The frontend connects to the FastAPI backend at `http://localhost:9000/api`

### Available Endpoints
- `GET /api/pantry` - List all items (with filters)
- `GET /api/pantry/expiring?days=7` - Get expiring items
- `POST /api/pantry` - Create new item
- `PUT /api/pantry/:id` - Update item
- `DELETE /api/pantry/:id` - Delete item

## 📝 Notes

- Auto-categorization and expiry estimation handled by backend
- All dates displayed relative (e.g., "2 days", "Tomorrow")
- Empty states include helpful prompts and cute mascot illustrations
- Form validation happens on both client and server

## 🎨 Comparison with v0

This implementation was designed independently with custom styling. A v0-generated version can be created in `v0-designs/` for comparison.

Key features of this implementation:
- Custom component architecture
- Optimized API integration
- Enhanced mobile experience
- Production-ready code structure

---

Built with 💖 for BubblyChef

