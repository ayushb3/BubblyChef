# BubblyChef 🍳

AI-powered pantry and recipe assistant with a cute, Sanrio-inspired aesthetic.

**Track your groceries • Scan receipts • Generate recipes • Never waste food**

![Tech Stack](https://img.shields.io/badge/Backend-Python%20%2B%20FastAPI-blue)
![Frontend](https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-cyan)
![AI](https://img.shields.io/badge/AI-Gemini%20%2B%20Ollama-purple)

---

## 📚 Documentation

**→ [Complete Documentation](docs/README.md)** - Architecture, guides, roadmap, and more

Quick Links:
- 🏗️ [Architecture Overview](docs/architecture/overview.md) - System design
- 🗺️ [Roadmap & TODO](docs/TODO.md) - Current tasks and future plans
- 🧪 [Testing Guide](docs/guides/testing.md) - Running tests
- 📝 [Logging Guide](docs/guides/logging.md) - Using the logging system

---

## 🚀 Quick Start

### Prerequisites

1. **Python 3.12+**
   ```bash
   python --version  # Should be 3.12 or higher
   ```

2. **Node.js 20+** (for frontend)
   ```bash
   node --version  # Should be 20 or higher
   ```

3. **Gemini API Key** (Recommended - Free tier available)
   - Get your key at: https://aistudio.google.com/
   - OR use Ollama (see Optional Setup below)

4. **Tesseract OCR** (for receipt scanning)
   ```bash
   # macOS
   brew install tesseract

   # Ubuntu/Debian
   sudo apt install tesseract-ocr
   ```

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/BubblyChef.git
cd BubblyChef

# 2. Set up Python environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# 3. Configure environment
cp .env.example .env
# Edit .env and add your BUBBLY_GEMINI_API_KEY

# 4. Install frontend dependencies
cd web
npm install
cd ..

# 5. Start the app
./start.sh
```

You'll be prompted to choose:
- **Both** backend and frontend (opens 2 terminals)
- **Backend only** (port 9000)
- **Frontend only** (port 5173)

The app will be available at:
- 🌐 **Frontend:** http://localhost:5173
- 🔧 **Backend API:** http://localhost:9000
- 📖 **API Docs:** http://localhost:9000/docs

### Quick Start Scripts

```bash
# Interactive menu (recommended)
./start.sh

# Or run directly:
./scripts/start-backend.sh   # Backend only
./scripts/start-frontend.sh  # Frontend only
```

### Optional: Ollama Setup (Self-hosted AI)

If you prefer self-hosted AI instead of Gemini:

```bash
# Install Ollama
brew install ollama  # macOS
# Or download from https://ollama.ai

# Start Ollama service
ollama serve

# Pull a model (in another terminal)
ollama pull llama3.2:3b

# Update .env
BUBBLY_OLLAMA_BASE_URL=http://localhost:11434
BUBBLY_OLLAMA_MODEL=llama3.2:3b
# Leave BUBBLY_GEMINI_API_KEY empty or remove it
```

---

## 🎯 Features

### ✅ Current (Phase 1B Complete)
- **Pantry Management** - Add, edit, delete items with auto-categorization
- **Smart Expiry Tracking** - Auto-estimates expiry dates, shows expiring items
- **Receipt Scanning** - OCR + AI to extract items from receipt photos
- **AI-Powered Parsing** - Uses Gemini to understand receipt text
- **Review & Confirm** - Human-in-the-loop for accuracy
- **Cute UI** - Sanrio-inspired pastel design with emojis

### 🚧 Coming Soon (Phase 1C)
- Recipe management and search
- "What can I make?" based on pantry items
- Recipe-to-shopping-list converter
- Recipe consumption tracking

See [docs/TODO.md](docs/TODO.md) for the full roadmap.

---

## 🛠️ Development

### Running Services

```bash
# Interactive menu - choose what to run
./start.sh

# Or run services separately:
./scripts/start-backend.sh   # Backend on port 9000
./scripts/start-frontend.sh  # Frontend on port 5173
```

### Manual Setup (Alternative)

```bash
# Backend (terminal 1)
source .venv/bin/activate
uvicorn bubbly_chef.api.app:app --reload --port 9000

# Frontend (terminal 2)
cd web
npm run dev
```

### Running Tests

```bash
# Backend tests
pytest

# With coverage
pytest --cov=bubbly_chef

# Run specific test
pytest tests/test_normalizer.py -v
```

### Logging Demo

```bash
python scripts/demo_logging.py
```

---

## 📁 Project Structure

```
BubblyChef/
├── bubbly_chef/          # Backend (Python + FastAPI)
│   ├── api/              # API endpoints
│   ├── ai/               # AI provider abstraction (Gemini, Ollama)
│   ├── domain/           # Business logic (normalizer, expiry)
│   ├── models/           # Data models
│   ├── repository/       # SQLite database layer
│   ├── services/         # OCR, receipt parsing
│   └── logger.py         # Logging system
│
├── web/                  # Frontend (React + TypeScript)
│   ├── src/
│   │   ├── api/          # API client + React Query hooks
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Page components (Pantry, Scan, etc.)
│   │   └── types/        # TypeScript definitions
│   └── public/           # Static assets
│
├── docs/                 # 📚 All documentation
│   ├── architecture/     # System design
│   ├── guides/           # How-to guides
│   ├── plans/            # Phase plans & roadmap
│   └── design/           # UI/UX design system
│
├── scripts/              # Development scripts
│   ├── dev.sh           # Start backend + frontend
│   ├── demo_logging.py  # Logging demo
│   └── test_scan.sh     # Receipt scan integration test
│
└── tests/                # Backend tests
```

---

## 🎨 Design Philosophy

BubblyChef embraces a **kawaii/Sanrio aesthetic**:
- 🎀 Soft pastel colors (pink, mint, lavender, peach)
- ✨ Rounded corners on all components
- 🥕 Liberal use of food emojis
- 💖 Friendly, approachable interface
- 📱 Mobile-first responsive design

See [docs/design/v0-prompts.md](docs/design/v0-prompts.md) for the complete design system.

---

## 🤝 Contributing

Want to contribute? Awesome!

1. Check [docs/TODO.md](docs/TODO.md) for tasks
2. Read [docs/architecture/overview.md](docs/architecture/overview.md) to understand the system
3. Follow the guides in [docs/guides/](docs/guides/)
4. Make your changes and submit a PR!

---

## 📄 License

MIT

---

## 🙏 Acknowledgments

Built with:
- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- [React](https://react.dev/) + [Vite](https://vitejs.dev/) - Fast frontend tooling
- [Gemini](https://ai.google.dev/) - Google's AI for receipt parsing
- [Ollama](https://ollama.ai/) - Local AI alternative
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) - Receipt text extraction
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first styling

Special thanks to the Sanrio aesthetic for making grocery tracking delightful! 🌸
