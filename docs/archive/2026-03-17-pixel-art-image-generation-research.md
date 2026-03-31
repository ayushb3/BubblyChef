# Pixel Art Image Generation — API Research

**Date:** 2026-03-17
**Goal:** Generate 64x64 pixel art food item sprites from a Python FastAPI backend.

---

## 1. Gemini / Google Image Generation

### What's Available

Google offers image generation via two separate systems:

**a) Imagen models** (dedicated text-to-image, via `google-genai` SDK):
- `imagen-4.0-generate-001` — flagship quality
- `imagen-4.0-fast-generate-001` — faster/cheaper
- `imagen-4.0-ultra-generate-001` — highest quality

**b) Gemini multimodal image generation** (text + image in/out, via `generate_content`):
- `gemini-2.0-flash-exp` — experimental, supports image output
- Newer preview models (naming shifts frequently in docs)

### Free Tier Status

**Imagen 3/4 is NOT on the free tier.** It requires a paid Google Cloud / Vertex AI project.
The Google AI Studio free key does NOT cover Imagen models — you get a quota error.

`gemini-2.0-flash-exp` image generation *was* free during experimental phase but availability
fluctuates. As of early 2026, image generation output via the generativelanguage API is
restricted and not reliably available on the free AI Studio key.

### Python SDK Call (if you had access)

```python
from google import genai
from google.genai import types

client = genai.Client(api_key="YOUR_KEY")

response = client.models.generate_content(
    model="gemini-2.0-flash-exp",  # or imagen-4.0-generate-001
    contents="pixel art food sprite, 64x64, apple, transparent background",
    config=types.GenerateContentConfig(
        response_modalities=["IMAGE", "TEXT"]
    )
)

for part in response.parts:
    if part.inline_data is not None:
        image = part.as_image()  # returns PIL Image
        image.save("sprite.png")
```

**Note:** BubblyChef's current `GeminiProvider` uses raw httpx against
`generativelanguage.googleapis.com/v1beta` — this does NOT support image generation.
Would need to switch to the `google-genai` SDK or add a separate image-generation call.

### Verdict: Not viable for free tier. Skip unless upgrading to paid.

---

## 2. Hugging Face Inference Providers (Best Free Option)

### Free Tier
- **$0.10/month** of free credits for free-tier HF accounts
- No rate limit published, but $0.10 goes a long way for image gen
- Text-to-image via `huggingface_hub.InferenceClient` (Python)

### Best Models for Pixel Art Sprites

| Model | HF ID | Notes |
|---|---|---|
| pixel-art-xl | `nerijs/pixel-art-xl` | Most popular (6.3k likes), SDXL-based |
| FLUX pixel art LoRA | `UmeAiRT/FLUX.1-dev-LoRA-Modern_Pixel_art` | Highest quality, 2.98k likes, but FLUX.1-dev is gated |
| Sprite sheet generator | `Onodofthenorth/SD_PixelArt_SpriteSheet_Generator` | Sprite sheets specifically |

**Recommended: `nerijs/pixel-art-xl`** — available via inference, no gating, no trigger word.

### Python Call

```python
from huggingface_hub import InferenceClient
from PIL import Image

client = InferenceClient(api_key="HF_TOKEN")

image: Image.Image = client.text_to_image(
    prompt="pixel, a fresh red apple, food sprite, transparent background, simple",
    model="nerijs/pixel-art-xl",
    negative_prompt="3d render, realistic, blurry, photorealistic",
    width=512,   # generate at 512, then downsample
    height=512,
)

# Downsample to 64x64 using nearest-neighbor for crisp pixels
sprite = image.resize((64, 64), Image.NEAREST)
sprite.save("apple_sprite.png")
```

**Key insight:** Generate at 512x512, then downsample 8x with `Image.NEAREST` (not bilinear).
This is the standard technique for pixel-perfect results from latent diffusion models.

### Async wrapper for FastAPI

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor
from huggingface_hub import InferenceClient

_executor = ThreadPoolExecutor(max_workers=2)
_client = InferenceClient(api_key=os.environ["HF_TOKEN"])

async def generate_food_sprite(item_name: str) -> bytes:
    loop = asyncio.get_event_loop()
    image = await loop.run_in_executor(
        _executor,
        lambda: _client.text_to_image(
            prompt=f"pixel, {item_name}, food item sprite, cute kawaii",
            model="nerijs/pixel-art-xl",
            negative_prompt="3d render, realistic, photographic",
            width=512, height=512,
        )
    )
    sprite = image.resize((64, 64), Image.NEAREST)
    buf = io.BytesIO()
    sprite.save(buf, format="PNG")
    return buf.getvalue()
```

### Verdict: Best free option. $0.10/month is ~80+ images at typical SDXL pricing.

---

## 3. Replicate

- Flux Schnell: **$3.00 / 1000 images** (cheapest paid option)
- Flux Dev: **$0.025 / image**
- No meaningful free tier (pay-as-you-go only)
- Good pixel art LoRA models available
- Use `replicate` Python package

**Verdict:** Viable if $0.003/image is acceptable. Not free.

---

## 4. Stability AI

- API requires paid credits ($10 minimum purchase)
- No free tier for API access
- SD3 / SDXL-turbo available but not free

**Verdict:** Skip.

---

## 5. Prompting Tricks with Gemini Vision (No Image Output)

Gemini's text models can NOT generate pixel art images — they are language models.
The idea of "prompting tricks" using vision models (like describing pixel art in ASCII or
returning base64) does not work with Gemini's text-only output.

The only way to get image output from Gemini is via the explicit image generation models
(Imagen or gemini-2.0-flash-exp image modality), both of which require paid/experimental access.

---

## Recommended Approach for BubblyChef

**Primary:** Hugging Face `nerijs/pixel-art-xl` via `InferenceClient`
- Free $0.10/month credit covers development and light production use
- Single new dependency: `huggingface_hub` (already a common Python package)
- Generate at 512x512, downsample to 64x64 with `Image.NEAREST`
- Prompt format: `"pixel, {item_name}, food item, kawaii cute sprite"`

**Prompt template for food items:**
```
pixel, {item_name}, food item sprite, kawaii cute, simple, clean background
```
Negative: `3d render, realistic, blurry, photorealistic, text, watermark`

**Fallback:** Cache a default sprite (e.g., question mark or generic food icon) if HF quota
is exhausted. Store generated sprites in SQLite as base64 or on disk in `bubbly_chef/data/sprites/`.

**Future upgrade path:** When/if Gemini image generation opens free tier, swap in the
`generate_content` call as a second provider using the existing AIManager pattern.
