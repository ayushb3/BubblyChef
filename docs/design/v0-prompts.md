# BubblyChef UI Prompts for Vercel v0

Use these prompts with [v0.dev](https://v0.dev) to prototype UI components.

---

## Global Style Guide

**Add this preamble to any prompt to maintain consistent styling:**

```
Style Guide:
- Theme: Cute, bubbly, Sanrio-inspired aesthetic
- Colors: Soft pastel palette
  - Primary: Pastel pink (#FFB5C5)
  - Secondary: Pastel mint (#B5EAD7)
  - Accent: Pastel lavender (#C9B5E8)
  - Warning: Pastel peach (#FFDAB3)
  - Danger: Soft coral (#FF9AA2)
  - Background: Cream white (#FFF9F5)
  - Text: Soft charcoal (#4A4A4A)
- Typography: Rounded, friendly fonts (like Nunito, Quicksand, or Varela Round)
- Borders: Soft rounded corners (12-16px radius)
- Shadows: Subtle, warm-toned drop shadows
- Icons: Rounded, cute style (Phosphor icons or custom illustrations)
- Buttons: Pill-shaped with gentle hover animations
- Cards: Soft shadows, slightly raised appearance
- Empty states: Include cute illustrations or mascot character
- Overall vibe: Friendly, approachable, delightful to use
```

### Alternative Style Options

**Option A: Sanrio Kawaii (Default)**
```
Soft pastels, rounded everything, cute food mascot character, sparkle accents,
playful micro-interactions. Think Hello Kitty meets cooking app.
```

**Option B: Modern Pastel**
```
Cleaner lines, pastel colors but more minimalist. Less cutesy, more
sophisticated soft aesthetic. Think Notion meets pastel palette.
```

**Option C: Cozy Kitchen**
```
Warm pastels (peach, cream, soft yellow), hand-drawn style icons,
recipe card aesthetic, vintage-cute vibes. Think cottagecore cooking app.
```

---

## Prompt 1: Dashboard Home

```
Create a dashboard home page for a pantry/recipe app called "BubblyChef".

[INSERT STYLE GUIDE FROM ABOVE]

Layout (mobile-first, max-width 480px centered on desktop):

### Header
- App logo/name "BubblyChef" with a cute chef hat or bubble icon
- Greeting: "Good morning! 🍳" (time-based)

### Card 1: Expiring Soon
- Pastel card with soft shadow
- Header: "Use Soon! 🥺" with worried food mascot
- List 3-4 items:
  - Item name + cute food emoji
  - "expires in X days" badge
  - Badge colors: coral (expired), peach (1-2 days), mint (3+ days)
- Empty state: Happy mascot saying "Nothing expiring soon! ✨"
- Tap card → goes to pantry filtered by expiring

### Card 2: Quick Actions
- Three large, pill-shaped buttons in a row:
  - "📸 Scan Receipt" (pink)
  - "➕ Add Item" (mint)
  - "🍽️ What's for dinner?" (lavender)
- Buttons should have subtle bounce on tap

### Card 3: Recent Activity
- Simple list with cute icons:
  - "🥛 Added milk" - "2 hours ago"
  - "👩‍🍳 Made: Chicken Stir Fry" - "Yesterday"
- Soft dividers between items
- "See all" link at bottom

### Bottom Navigation
- Floating pill-shaped navbar with soft shadow
- Four items with icons + labels:
  - 🏠 Home (active state: filled icon, pink background pill)
  - 🥕 Pantry
  - 📷 Scan
  - ✨ Recipes
- Active state should be clearly highlighted
```

---

## Prompt 2: Pantry List

```
Create a pantry inventory list page for "BubblyChef" food tracking app.

[INSERT STYLE GUIDE FROM ABOVE]

Layout:

### Header
- Title: "My Pantry 🥕"
- Subtitle: "12 items" (count)
- Right side: Circular "+" add button (pastel pink)

### Filter Bar
- Horizontally scrollable pill chips:
  - "All" (default selected - filled pink)
  - "🧊 Fridge"
  - "❄️ Freezer"
  - "🏠 Pantry"
  - "🍎 Counter"
- Selected state: filled pastel color
- Unselected: outlined with pastel border

### Item List
Each item is a card with:
- Left: Cute category emoji/icon (🥛 dairy, 🥬 produce, 🍖 meat)
- Middle:
  - Item name (bold): "Milk"
  - Details (gray): "1 gallon · Dairy"
- Right:
  - Expiry badge as pill
  - "3 days" (mint), "Tomorrow!" (peach), "Expired" (coral)
- Subtle pastel left border indicating category color
- Tap → opens edit modal
- Swipe left → reveals soft coral delete button with 🗑️

### Empty State (when no items)
- Cute sad/hungry mascot illustration
- Text: "Your pantry is empty! 🥺"
- Subtext: "Let's add some yummy ingredients"
- Large "Add First Item" button (pink pill)

### Floating Action Button (alternative to header +)
- Bottom right, circular pink button with "+"
- Subtle shadow and bounce animation
```

---

## Prompt 3: Add/Edit Item Modal

```
Create a bottom sheet modal for adding a pantry item in "BubblyChef".

[INSERT STYLE GUIDE FROM ABOVE]

Layout:

### Modal Container
- Slides up from bottom (bottom sheet style)
- Rounded top corners (24px)
- Drag handle pill at top center
- Soft cream background

### Header
- Title: "Add Item ✨" (or "Edit Item" when editing)
- Close X button (top right, subtle)

### Form Fields

**Item Name** (required)
- Label: "What did you get? 🛒"
- Text input with rounded borders
- Placeholder: "e.g., Milk, Chicken breast..."
- Pastel pink focus ring

**Quantity & Unit** (side by side)
- Label: "How much?"
- Number input (left, 40% width)
- Unit dropdown (right, 60% width)
  - Options: count, lb, oz, g, kg, ml, L, gallon, bunch
- Dropdown has cute chevron icon

**Category**
- Label: "Category 📦"
- Dropdown with emoji prefixes:
  - 🥬 Produce
  - 🥛 Dairy
  - 🍖 Meat
  - 🐟 Seafood
  - ❄️ Frozen
  - 🏠 Pantry Staples
  - 🥤 Beverages
  - 🧂 Condiments
  - 📦 Other

**Storage Location**
- Label: "Where does it go?"
- Segmented control (pill-shaped buttons):
  - 🧊 Fridge | ❄️ Freezer | 🏠 Pantry | 🍎 Counter
- Selected: filled pastel, others: outlined

**Expiry Date** (optional)
- Label: "Best by 📅"
- Date picker input
- Helper text below: "💡 Leave blank to auto-estimate"
- Optional: "Estimate for me" link that auto-fills based on category

### Action Buttons
- Bottom of modal, full width
- "Cancel" - text button (gray)
- "Save Item" - filled pill button (pastel pink)
- Buttons have subtle shadow and hover state
```

---

## Prompt 4: Receipt Scan Page

```
Create a receipt scanning page for "BubblyChef" grocery app.

[INSERT STYLE GUIDE FROM ABOVE]

### State 1: Upload State

**Header**
- Title: "Scan Receipt 📸"
- Subtitle: "Add groceries in seconds!"

**Upload Zone**
- Large dashed border box (pastel pink dashed line)
- Rounded corners (16px)
- Center content:
  - Cute camera/receipt illustration or mascot holding receipt
  - Text: "Drop your receipt here"
  - Subtext: "or tap to upload 📷"
- Accepts drag & drop
- Tap opens file picker (image types)
- Subtle background pattern (very light polka dots or grid)

**Tips Section**
- Small card below:
- "📝 Tips for best results:"
  - "• Flatten the receipt"
  - "• Good lighting helps!"
  - "• Include all items in frame"

---

### State 2: Processing State

- Upload zone replaced with:
  - Cute loading animation (bouncing food items or spinning mascot)
  - Text: "Reading your receipt... 🔍"
  - Subtext: "This might take a moment"

---

### State 3: Results State

**Success Header**
- Mascot celebration illustration
- "Found 8 items! 🎉"

**Section: Auto-Added** (collapsible, default open)
- Header: "✅ Added to Pantry" with item count badge
- Green-tinted card background
- List of items:
  - ✅ Milk (1 gallon)
  - ✅ Eggs (12 count)
  - Each has "Undo" text link on right
- "Undo All" link at bottom of section

**Section: Needs Review** (if any low-confidence items)
- Header: "🤔 Please Check" with item count badge
- Peach-tinted card background
- Each item row:
  - Checkbox (rounded, pastel)
  - Editable item name input
  - Quantity + unit inputs (smaller)
  - Gray helper text: original OCR text ("ORG MLK 1GL")
  - Delete row X button
- "Add Selected" pill button at bottom (pink)

**Section: Couldn't Read** (if any failed items)
- Header: "❌ Couldn't read these"
- Gray-tinted card
- List of raw OCR text that failed
- "Add manually" link

**Bottom Actions**
- "Done" primary button → returns to pantry
- "Scan Another" secondary text link
```

---

## Prompt 5: Recipe Generation Page

```
Create a recipe generation page for "BubblyChef" AI cooking assistant.

[INSERT STYLE GUIDE FROM ABOVE]

### State 1: Input State

**Header**
- Title: "What's for Dinner? ✨"
- Cute chef mascot illustration

**Input Section**
- Large text input (rounded, multi-line capable)
- Placeholder: "I want something with chicken..."
- Pastel pink focus ring
- Microphone icon button (for future voice input)

**Quick Suggestion Chips** (horizontally scrollable)
- "🍝 Quick pasta"
- "🥗 Healthy salad"
- "🍜 Asian flavors"
- "🥘 One pot meal"
- "🍳 Use my expiring items"
- Tapping chip fills input with that text

**Filter Toggles** (optional section, collapsible)
- Label: "Preferences"
- Toggle pills:
  - "⏱️ Under 30 min"
  - "🌱 Vegetarian"
  - "🥕 Use expiring items first"

**Generate Button**
- Large pill button: "✨ Find me a recipe!"
- Pastel pink with subtle sparkle icon
- Full width

---

### State 2: Loading State

- Input area dims slightly
- Center of screen:
  - Cute cooking animation (stirring pot, bouncing vegetables)
  - Text: "Cooking up ideas... 👩‍🍳"
  - Subtext: "Checking your pantry..."

---

### State 3: Recipe Display State

**Ingredient Status Banner** (top, dismissible)
- If missing items: Soft peach background
  - "Missing 2 ingredients 🛒"
- If have everything: Soft mint background
  - "You have everything! 🎉"

**Recipe Card**
- Large card with soft shadow
- Header:
  - Recipe title: "Honey Garlic Chicken 🍯"
  - Row of pills: "30 min" "4 servings" "Easy"
- Cute food illustration or photo placeholder

**Ingredients Section**
- Header: "Ingredients 🥕"
- List with availability indicators:
  - ✅ "2 chicken breasts" (green check, you have it)
  - ✅ "4 cloves garlic" (green check)
  - ⚠️ "2 tbsp honey" - "have 1 tbsp" (yellow, partial)
  - ❌ "1 tbsp sesame oil" (coral X, missing)
- Missing items are slightly grayed but readable

**Instructions Section**
- Header: "Let's Cook! 👩‍🍳"
- Numbered steps in cards:
  1. Card with step text, soft background
  2. Each step is its own mini-card
  - Optional: checkbox to mark done

**Action Buttons** (bottom sticky)
- "🔄 Try Another Recipe" - outlined button
- "💾 Save Recipe" - filled pink button (Phase 2)
- "🛒 Add Missing to List" - text link
```

---

## Prompt 6: Chat Interface (Phase 2 Preview)

```
Create a chat interface for "BubblyChef" AI cooking assistant.

[INSERT STYLE GUIDE FROM ABOVE]

### Layout

**Header**
- "Chat with BubblyChef 💬"
- Cute small mascot avatar
- Settings gear icon (right)

**Chat Area** (scrollable)

**User Messages** (right-aligned)
- Pastel pink bubble
- Rounded corners (more rounded on right side)
- Soft shadow
- Timestamp below (small, gray)

**Assistant Messages** (left-aligned)
- Cream/white bubble with pastel border
- Small mascot avatar to the left of bubble
- Can contain:
  - Plain text
  - Embedded mini recipe cards
  - Ingredient lists with checkboxes
  - Action buttons

**Rich Message Types:**

*Recipe Card (embedded in chat):*
- Compact version of recipe card
- Shows: title, time, ingredient count
- "View Full Recipe" button
- Soft card within the bubble

*Pantry Items (embedded):*
- Mini list of items
- Checkmarks or X for have/don't have
- Compact styling

*Action Buttons (embedded):*
- Appear below assistant message
- Pill buttons in a row:
  - "Yes, add these" (mint)
  - "No thanks" (gray outline)
- Buttons disappear or gray out after tapped

**Typing Indicator**
- Three bouncing dots in assistant bubble style
- Subtle animation

### Input Area (bottom, sticky)
- Rounded input field
- Placeholder: "Ask me anything about cooking..."
- Right side: Pink circular send button with arrow
- Optional: attachment icon for receipts

**Example Conversation:**
1. User: "What can I make with chicken?"
2. Assistant: "Let me check your pantry! 🔍"
3. Assistant: [Typing indicator]
4. Assistant: "Based on what you have, here's a tasty option!" + [Mini Recipe Card: Honey Garlic Chicken] + "Want me to find more options?"
5. [Action buttons: "Yes, more options" / "This looks good!"]
```

---

## Tips for Using v0

1. **Start with one prompt at a time** - don't overload
2. **Iterate** - say "make the buttons more rounded" or "use softer shadows"
3. **Reference the style guide** - paste it at the top of each prompt
4. **Export what you like** - v0 generates React/Tailwind code you can use directly
5. **Mix and match** - take the header from one iteration, cards from another

---

## Color Reference (Copy-Paste)

```css
/* BubblyChef Pastel Palette */
--pastel-pink: #FFB5C5;
--pastel-mint: #B5EAD7;
--pastel-lavender: #C9B5E8;
--pastel-peach: #FFDAB3;
--pastel-coral: #FF9AA2;
--pastel-yellow: #FFF1B5;
--pastel-blue: #B5D8EB;
--cream-white: #FFF9F5;
--soft-charcoal: #4A4A4A;
--light-gray: #F5F5F5;
```

---

## Mascot Ideas (for illustrations)

- A cute blob-shaped chef with a tiny chef hat
- A round, blushing onion or egg character
- A smiling pot with steam coming out
- A happy refrigerator character
- Food items with cute faces (kawaii style)

You can ask v0 to include these or generate them separately!
