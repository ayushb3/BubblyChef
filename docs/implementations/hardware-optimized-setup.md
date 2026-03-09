# Optimized Model Recommendations for Your Hardware

## Your Setup
- **Mac:** M4 with 48GB RAM - **EXCELLENT for local AI**
- **Windows PC:** RTX 3070 (8GB VRAM) - Good for smaller models

---

## 🏆 Best Options for M4 Mac (48GB RAM)

### Option 1: qwen2.5:32b (Recommended)
```bash
# On M4 Mac
ollama pull qwen2.5:32b

# Update .env
BUBBLY_OLLAMA_MODEL=qwen2.5:32b
```

**Why this is perfect for you:**
- ✅ Uses ~24GB RAM (you have 48GB - plenty of headroom)
- ✅ Excellent recipe quality (top-tier model)
- ✅ Fast on M4 (~15-25 seconds per recipe)
- ✅ Better than any Gemini model
- ✅ No API limits, works offline
- ✅ M4's Neural Engine accelerates it

**Performance estimate:**
- Generation time: 15-25 seconds
- RAM usage: ~24GB
- CPU usage: Moderate (Neural Engine does heavy lifting)

### Option 2: llama3.1:70b (Highest Quality)
```bash
# On M4 Mac
ollama pull llama3.1:70b

# Update .env
BUBBLY_OLLAMA_MODEL=llama3.1:70b
```

**Trade-offs:**
- ✅ Best possible quality
- ✅ Very creative recipes
- ⚠️ Uses ~40GB RAM (still fits!)
- ⚠️ Slower: 30-45 seconds per recipe
- ⚠️ Will work but might be overkill for recipes

### Option 3: qwen2.5:14b (Fast + Quality)
```bash
# On M4 Mac
ollama pull qwen2.5:14b

# Update .env
BUBBLY_OLLAMA_MODEL=qwen2.5:14b
```

**Sweet spot:**
- ✅ Only ~12GB RAM
- ✅ Very fast: 10-15 seconds
- ✅ Excellent quality for recipes
- ✅ Leaves RAM for other apps

---

## For Windows PC (RTX 3070 - 8GB VRAM)

### Option 1: qwen2.5:7b (Recommended)
```bash
# On Windows PC with Ollama
ollama pull qwen2.5:7b

# Update .env
BUBBLY_OLLAMA_MODEL=qwen2.5:7b
```

**Why:**
- ✅ Fits in 8GB VRAM
- ✅ Fast GPU inference
- ✅ Great recipe quality
- ✅ ~20-30 seconds per recipe

### Option 2: gemma2:9b
```bash
ollama pull gemma2:9b
```

**Why:**
- ✅ Fits in 8GB VRAM (optimized for NVIDIA)
- ✅ Google-made, good at following instructions
- ⚠️ Slightly slower than qwen on GPU

**Note:** RTX 3070 is good, but 8GB VRAM limits you to 7-9B models. The M4 Mac is better for this use case.

---

## My Specific Recommendation

### 🎯 Use M4 Mac with qwen2.5:32b

**Setup:**
```bash
# 1. Install Ollama on Mac
brew install ollama

# 2. Start Ollama (in separate terminal or background)
ollama serve

# 3. Pull the 32B model (one-time, ~20GB download)
ollama pull qwen2.5:32b

# 4. Update .env
# Option A: Remove Gemini key to use Ollama as primary
# Option B: Keep Gemini as fallback
BUBBLY_OLLAMA_MODEL=qwen2.5:32b

# 5. Verify Ollama is accessible
curl http://localhost:11434/api/tags

# 6. Start BubblyChef backend on Mac
uvicorn bubbly_chef.api.app:app --reload --port 8888

# 7. Test recipe generation
curl -X POST http://localhost:8888/api/recipes/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "delicious pasta carbonara"}'
```

**Expected Performance:**
- First request: ~20 seconds (model loading)
- Subsequent requests: ~15 seconds
- RAM usage: ~24GB (out of 48GB)
- Quality: Better than Gemini 2.0
- Cost: $0 (unlimited)

---

## Performance Comparison

### Your M4 Mac Options

| Model | RAM | Speed | Quality | Recommendation |
|-------|-----|-------|---------|----------------|
| qwen2.5:7b | 8GB | ⚡⚡⚡⚡ 10s | ⭐⭐⭐⭐ | Good |
| qwen2.5:14b | 12GB | ⚡⚡⚡ 15s | ⭐⭐⭐⭐⭐ | Excellent |
| **qwen2.5:32b** | 24GB | ⚡⚡⚡ 20s | ⭐⭐⭐⭐⭐⭐ | **BEST** |
| llama3.1:70b | 40GB | ⚡⚡ 35s | ⭐⭐⭐⭐⭐⭐ | Overkill |

### Windows RTX 3070 Options

| Model | VRAM | Speed | Quality | Notes |
|-------|------|-------|---------|-------|
| gemma2:2b | 2GB | ⚡⚡⚡⚡ 8s | ⭐⭐ | Too simple |
| qwen2.5:7b | 6GB | ⚡⚡⚡ 20s | ⭐⭐⭐⭐ | Good fit |
| gemma2:9b | 7GB | ⚡⚡⚡ 25s | ⭐⭐⭐⭐ | Max for 8GB |

---

## Why M4 Mac is Perfect for This

### M4 Advantages:
1. **48GB Unified Memory** - Can run 32B models easily
2. **Neural Engine** - Accelerates AI inference
3. **Efficient Architecture** - Low power, cool running
4. **Memory Bandwidth** - 273 GB/s on M4 Pro/Max

### Comparison:
- **M4 Mac (48GB):** Run 32B models → ⭐⭐⭐⭐⭐⭐ quality
- **RTX 3070 (8GB):** Run 7-9B models → ⭐⭐⭐⭐ quality
- **Gemini API:** Rate limited, occasional issues

---

## Step-by-Step Setup on M4 Mac

### 1. Install Ollama
```bash
# Download from ollama.ai or use brew
brew install ollama
```

### 2. Start Ollama Server
```bash
# Option A: Run in foreground (see logs)
ollama serve

# Option B: Run as background service
brew services start ollama
```

### 3. Pull Model (Choose One)

#### Recommended: qwen2.5:32b
```bash
ollama pull qwen2.5:32b
# Download: ~20GB, takes 5-10 minutes on fast connection
```

#### Alternative: qwen2.5:14b (faster)
```bash
ollama pull qwen2.5:14b
# Download: ~9GB, takes 2-5 minutes
```

### 4. Test Model Directly
```bash
# Test the model works
ollama run qwen2.5:32b "Generate a simple pasta recipe"

# Should output a recipe in ~15-20 seconds
```

### 5. Configure BubblyChef

Edit `.env`:
```bash
# Option A: Use Ollama as primary (remove/comment Gemini key)
#BUBBLY_GEMINI_API_KEY=your-key

# Set Ollama model
BUBBLY_OLLAMA_MODEL=qwen2.5:32b

# Optional: Keep Gemini as fallback
BUBBLY_GEMINI_API_KEY=your-key
BUBBLY_GEMINI_MODEL=gemini-2.0-flash-exp
```

### 6. Start Backend
```bash
# In BubblyChef directory
uvicorn bubbly_chef.api.app:app --reload --port 8888
```

### 7. Verify in Logs
Look for:
```
✨ Generated recipe: [Recipe Name] (match: X%, have: Y, missing: Z)
```

And check which provider was used in the logs.

---

## Resource Usage Monitoring

### On Mac (Activity Monitor)
```bash
# While generating recipes, check:
# Activity Monitor → Memory tab → Look for "ollama"
# Should see ~24GB for 32B model
# Should see ~12GB for 14B model
```

### Via Terminal
```bash
# Install htop if needed
brew install htop

# Monitor while generating
htop

# Look for ollama process memory usage
```

---

## Troubleshooting

### Model Too Slow on Mac?
```bash
# Try smaller model
ollama pull qwen2.5:14b

# Update .env
BUBBLY_OLLAMA_MODEL=qwen2.5:14b

# Should be ~10 seconds per recipe
```

### Running Out of RAM?
```bash
# Check current usage
ollama ps

# Unload models you're not using
ollama stop qwen2.5:32b

# Load smaller model
ollama pull qwen2.5:7b
```

### Want to Use Both Machines?

**Option:** Run Ollama on Mac, access from Windows PC
```bash
# On Mac: Start Ollama with network access
OLLAMA_HOST=0.0.0.0:11434 ollama serve

# On Windows PC: Point to Mac
# In .env:
BUBBLY_OLLAMA_BASE_URL=http://YOUR_MAC_IP:11434
BUBBLY_OLLAMA_MODEL=qwen2.5:32b
```

---

## Bottom Line

### For BubblyChef Recipe Generation:

**🏆 BEST SETUP:**
```
M4 Mac (48GB) + qwen2.5:32b
= Best quality, fast, unlimited, offline
```

**⚙️ SETUP TIME:** 10 minutes
**💰 COST:** $0
**⚡ SPEED:** ~15-20 seconds per recipe
**🎯 QUALITY:** Better than any Gemini model
**📶 NETWORK:** Works completely offline

This is your ideal setup. The M4 with 48GB RAM is absolutely perfect for running high-quality local models. You'll get better results than Gemini API with no rate limits.
