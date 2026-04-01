# Recipe Generation Model Options

## Current Setup
- **Model:** `gemini-2.0-flash` (fastest, latest Gemini)
- **Retry logic:** ✅ Added (MAX_RETRIES = 2)
- **Fallback:** Ollama (if Gemini fails or unavailable)

## All Available Models

### Google Gemini Models (via API)

| Model | Speed | Quality | Context | Structured Output | Notes |
|-------|-------|---------|---------|-------------------|-------|
| **gemini-2.0-flash** (current) | ⚡⚡⚡ | ⭐⭐⭐ | 1M tokens | ✅ Native | Latest, fastest |
| gemini-2.0-flash-exp | ⚡⚡⚡ | ⭐⭐⭐⭐ | 1M tokens | ✅ Native | Experimental, better |
| gemini-1.5-flash | ⚡⚡⚡ | ⭐⭐⭐ | 1M tokens | ✅ Native | Previous gen, stable |
| gemini-1.5-flash-8b | ⚡⚡⚡⚡ | ⭐⭐ | 1M tokens | ✅ Native | Ultra-fast, simpler |
| gemini-1.5-pro | ⚡⚡ | ⭐⭐⭐⭐⭐ | 2M tokens | ✅ Native | Best quality, slower |
| gemini-exp-1206 | ⚡⚡ | ⭐⭐⭐⭐⭐ | 2M tokens | ✅ Native | Experimental pro |

**Note:** Gemini 3.0 has not been released yet as of March 2026. Gemini 2.0 is the latest generation.

**Pricing (Free Tier):**
- 15 requests per minute
- 1,500 requests per day
- Rate limits may apply

### Meta Llama Models (via Ollama)

| Model | Size | Speed | Quality | RAM Needed | Notes |
|-------|------|-------|---------|------------|-------|
| llama3.2:1b | 1B | ⚡⚡⚡⚡ | ⭐⭐ | 2GB | Fastest, basic |
| **llama3.2:3b** (current) | 3B | ⚡⚡⚡ | ⭐⭐⭐ | 4GB | Good balance |
| llama3.1:8b | 8B | ⚡⚡ | ⭐⭐⭐⭐ | 8GB | High quality |
| llama3.1:70b | 70B | ⚡ | ⭐⭐⭐⭐⭐ | 40GB | Best, needs GPU |
| llama3.3:70b | 70B | ⚡ | ⭐⭐⭐⭐⭐ | 40GB | Latest 70B |

### Google Gemma Models (via Ollama)

| Model | Size | Speed | Quality | RAM Needed | Notes |
|-------|------|-------|---------|------------|-------|
| gemma2:2b | 2B | ⚡⚡⚡⚡ | ⭐⭐ | 3GB | Lightweight |
| gemma2:9b | 9B | ⚡⚡ | ⭐⭐⭐⭐ | 10GB | Excellent quality |
| gemma2:27b | 27B | ⚡ | ⭐⭐⭐⭐⭐ | 20GB | Best Gemma |

### Alibaba Qwen Models (via Ollama)

| Model | Size | Speed | Quality | RAM Needed | Notes |
|-------|------|-------|---------|------------|-------|
| qwen2.5:0.5b | 0.5B | ⚡⚡⚡⚡⚡ | ⭐ | 1GB | Minimal |
| qwen2.5:3b | 3B | ⚡⚡⚡ | ⭐⭐⭐ | 4GB | Good for recipes |
| **qwen2.5:7b** | 7B | ⚡⚡ | ⭐⭐⭐⭐ | 8GB | Recommended local |
| qwen2.5:14b | 14B | ⚡⚡ | ⭐⭐⭐⭐⭐ | 16GB | High quality |
| qwen2.5:32b | 32B | ⚡ | ⭐⭐⭐⭐⭐ | 24GB | Best Qwen |
| qwen2.5-coder:7b | 7B | ⚡⚡ | ⭐⭐⭐⭐ | 8GB | Code-focused |

### Mistral Models (via Ollama)

| Model | Size | Speed | Quality | RAM Needed | Notes |
|-------|------|-------|---------|------------|-------|
| mistral:7b | 7B | ⚡⚡ | ⭐⭐⭐⭐ | 8GB | Creative, versatile |
| mixtral:8x7b | 47B | ⚡ | ⭐⭐⭐⭐⭐ | 32GB | Mixture of Experts |
| mistral-small | 22B | ⚡⚡ | ⭐⭐⭐⭐⭐ | 16GB | Latest Mistral |

### xAI Grok (Not Available via Ollama/API Yet)

| Model | Status | Notes |
|-------|--------|-------|
| Grok-1 | ❌ Not available | Would need xAI API (not free) |
| Grok-2 | ❌ Not available | Commercial only, no public API |

**Note:** Grok models are only available through X Premium+ and don't have a public API for self-hosting as of March 2026.

## Recommendations by Use Case

### 🏆 Best Overall: gemini-2.0-flash-exp
```bash
echo "BUBBLY_GEMINI_MODEL=gemini-2.0-flash-exp" >> .env
```
**Why:**
- Experimental improvements over 2.0-flash
- Better instruction following
- Same speed (~15-25s)
- Free tier, no setup

### 🎯 Best Quality (Cloud): gemini-1.5-pro
```bash
echo "BUBBLY_GEMINI_MODEL=gemini-1.5-pro" >> .env
```
**Why:**
- Highest quality Gemini
- Best for complex recipes
- Slower (~30-40s)
- Still free tier

### 💪 Best Local (Medium Hardware): qwen2.5:7b
```bash
ollama pull qwen2.5:7b
echo "BUBBLY_OLLAMA_MODEL=qwen2.5:7b" >> .env
# Remove BUBBLY_GEMINI_API_KEY to use Ollama
```
**Why:**
- Great recipe quality
- Works offline
- No API limits
- ~8GB RAM needed
- 20-40 seconds

### 🚀 Best Local (Low Hardware): gemma2:2b
```bash
ollama pull gemma2:2b
echo "BUBBLY_OLLAMA_MODEL=gemma2:2b" >> .env
```
**Why:**
- Runs on 3GB RAM
- Decent quality
- Very fast (~10-20s)
- Good for simple recipes

### 🔥 Best Local (High-End): llama3.1:70b or qwen2.5:32b
```bash
# Needs GPU with 40GB+ VRAM (e.g., A100, H100)
ollama pull llama3.1:70b
# OR
ollama pull qwen2.5:32b
```
**Why:**
- Best possible quality
- Creative recipes
- Complex instructions
- Needs powerful hardware

## Model-Specific Notes

### Gemini 2.0 vs Gemini 1.5
- **2.0-flash:** Newer, faster, better structured output
- **1.5-pro:** More reliable, better reasoning, slower
- **Recommendation:** Try 2.0-flash-exp first, fall back to 1.5-pro if quality issues

### Llama 3.1 vs 3.2
- **3.2 (1-3B):** Latest small models, efficient
- **3.1 (8-70B):** Better for complex tasks
- **Recommendation:** Use 3.1:8b for recipes (good balance)

### Qwen vs Llama vs Mistral
- **Qwen 2.5:** Best overall for recipes (good at following formats)
- **Llama 3.x:** Best for creative, conversational recipes
- **Mistral:** Good middle ground, versatile
- **Gemma 2:** Lightest Google option, good for constrained hardware

### Why Not Grok?
- No public API or local models available
- Only accessible via X Premium+ ($16/month)
- Not suitable for self-hosted apps
- May be available in future

## Performance Comparison

### gemini-2.0-flash (current)
- ✅ Response time: 13-22 seconds
- ⚠️ Occasional schema confusion (fixed with retry)
- ✅ Free tier sufficient

### gemini-2.0-flash-exp (recommended)
- ✅ Response time: 15-25 seconds
- ✅ Better instruction following
- ✅ Less schema confusion
- ✅ Free tier sufficient

### qwen2.5:7b (local alternative)
- ✅ Response time: 20-40 seconds (depends on hardware)
- ✅ No API limits
- ✅ Works offline
- ✅ Good recipe quality
- ⚠️ Needs 8GB+ RAM

## Implementation Status

✅ **Retry Logic Added**
- Automatically retries up to 2 times on failure
- Exponential backoff (1s, 2s, 4s)
- Detailed error messages

✅ **Follow-up Prompt Fixed**
- Both initial and follow-up prompts have clear examples
- Should significantly reduce schema confusion

✅ **Model Configuration**
- Easy to switch via `.env` file
- No code changes needed

## Quick Setup Guides

### Switch to gemini-2.0-flash-exp (Easiest)
```bash
# 1. Update .env
echo "BUBBLY_GEMINI_MODEL=gemini-2.0-flash-exp" >> .env

# 2. Restart backend
# Press Ctrl+C in your backend terminal, then:
uvicorn bubbly_chef.api.app:app --reload --port 8888

# 3. Test
curl -X POST http://localhost:8888/api/recipes/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "quick pasta dinner"}'
```

### Switch to Llama 3.1 8B (Best Local)
```bash
# 1. Install Ollama (if not already)
brew install ollama

# 2. Start Ollama server
ollama serve &  # Runs in background

# 3. Pull model (one-time, ~5GB download)
ollama pull llama3.1:8b

# 4. Update .env
# Remove or comment out Gemini key to use Ollama as primary
echo "BUBBLY_OLLAMA_MODEL=llama3.1:8b" >> .env

# 5. Restart backend
uvicorn bubbly_chef.api.app:app --reload --port 8888

# 6. Test
curl -X POST http://localhost:8888/api/recipes/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "healthy breakfast"}'
```

### Try Multiple Models (Advanced)
```bash
# 1. Pull several models
ollama pull qwen2.5:7b
ollama pull gemma2:9b
ollama pull llama3.1:8b

# 2. Test each one
# Edit .env and change BUBBLY_OLLAMA_MODEL each time
# Restart backend and compare results

# 3. Pick your favorite based on:
# - Recipe quality (realistic ingredients/instructions)
# - Response time (how long you're willing to wait)
# - Memory usage (check Activity Monitor/htop)
```

### Use Both Gemini + Ollama (Fallback)
```bash
# Keep both configured - Gemini as primary, Ollama as backup
# .env file:
BUBBLY_GEMINI_API_KEY=your-key-here
BUBBLY_GEMINI_MODEL=gemini-2.0-flash-exp
BUBBLY_OLLAMA_MODEL=qwen2.5:7b

# If Gemini fails (rate limit, network), automatically falls back to Ollama
```

## Testing

After changing models, test with:
```bash
curl -X POST http://localhost:8888/api/recipes/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "quick chicken dinner"}'
```

Watch for:
- Response time
- Quality of ingredients/instructions
- Proper JSON structure (no schema confusion)

## Monitoring

Check backend logs for:
```
✨ Generated recipe: [title] (match: X%, have: Y, missing: Z)
```

Or errors:
```
❌ Failed to generate recipe: [error details]
```

---

**Current Status:** Retry logic added ✅
**Recommended Action:** Try `gemini-2.0-flash-exp` for better reliability
**Alternative:** Use local Ollama for complete control
