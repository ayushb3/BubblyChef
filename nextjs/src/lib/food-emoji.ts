const FOOD_EMOJI: Record<string, string> = {
  // Produce
  apple: '🍎', banana: '🍌', orange: '🍊', lemon: '🍋', lime: '🍋',
  grape: '🍇', grapes: '🍇', strawberry: '🍓', strawberries: '🍓',
  blueberry: '🫐', blueberries: '🫐', raspberry: '🫐', peach: '🍑',
  pear: '🍐', cherry: '🍒', cherries: '🍒', watermelon: '🍉',
  mango: '🥭', pineapple: '🍍', coconut: '🥥', avocado: '🥑',
  tomato: '🍅', tomatoes: '🍅', potato: '🥔', potatoes: '🥔',
  'sweet potato': '🍠', carrot: '🥕', carrots: '🥕', corn: '🌽',
  broccoli: '🥦', lettuce: '🥬', spinach: '🥬', kale: '🥬',
  cucumber: '🥒', 'bell pepper': '🫑', pepper: '🌶️', chili: '🌶️',
  garlic: '🧄', onion: '🧅', onions: '🧅', mushroom: '🍄',
  mushrooms: '🍄', ginger: '🫚', eggplant: '🍆', celery: '🥬',
  cabbage: '🥬', zucchini: '🥒', asparagus: '🥬',

  // Dairy
  milk: '🥛', cheese: '🧀', butter: '🧈', yogurt: '🥛',
  cream: '🥛', 'sour cream': '🥛', 'cream cheese': '🧀',
  'ice cream': '🍦', egg: '🥚', eggs: '🥚',

  // Meat & Protein
  chicken: '🍗', beef: '🥩', steak: '🥩', pork: '🥓',
  bacon: '🥓', ham: '🍖', sausage: '🌭', turkey: '🦃',
  lamb: '🍖', fish: '🐟', salmon: '🐟', tuna: '🐟',
  shrimp: '🦐', crab: '🦀', lobster: '🦞', tofu: '🫘',

  // Grains & Baking
  bread: '🍞', rice: '🍚', pasta: '🍝', noodles: '🍜',
  flour: '🌾', oats: '🌾', oatmeal: '🌾', cereal: '🥣',
  tortilla: '🫓', tortillas: '🫓', bagel: '🥯', croissant: '🥐',
  pancake: '🥞', waffle: '🧇',

  // Condiments & Sauces
  'soy sauce': '🥫', ketchup: '🥫', mustard: '🥫', mayo: '🥫',
  mayonnaise: '🥫', 'hot sauce': '🌶️', vinegar: '🥫',
  'olive oil': '🫒', oil: '🫒', honey: '🍯', sugar: '🍬',
  salt: '🧂',

  // Snacks
  chips: '🍟', popcorn: '🍿', pretzel: '🥨', cookie: '🍪',
  cookies: '🍪', chocolate: '🍫', candy: '🍬', nuts: '🥜',
  peanut: '🥜', 'peanut butter': '🥜', almond: '🥜', almonds: '🥜',

  // Beverages
  water: '💧', coffee: '☕', tea: '🍵', juice: '🧃',
  'orange juice': '🍊', soda: '🥤', beer: '🍺', wine: '🍷',
  'coconut water': '🥥',

  // Frozen
  'frozen pizza': '🍕', pizza: '🍕',

  // Beans & Legumes
  beans: '🫘', lentils: '🫘', chickpeas: '🫘',

  // Misc
  sandwich: '🥪', burrito: '🌯', taco: '🌮', sushi: '🍣',
  soup: '🍲', salad: '🥗', cake: '🎂', pie: '🥧', donut: '🍩',
}

const CATEGORY_FALLBACK: Record<string, string> = {
  produce: '🥬',
  dairy: '🧈',
  meat: '🍗',
  protein: '🍗',
  dry_goods: '🌾',
  grains: '🌾',
  condiments: '🧂',
  snacks: '🍿',
  beverages: '🥤',
  frozen: '🧊',
  baking: '🌾',
  other: '🍽️',
}

export function getFoodEmoji(name: string, category?: string): string {
  const lower = name.toLowerCase().trim()

  // Exact match
  if (FOOD_EMOJI[lower]) return FOOD_EMOJI[lower]

  // Substring match (e.g., "organic whole milk" → match "milk")
  for (const [key, emoji] of Object.entries(FOOD_EMOJI)) {
    if (lower.includes(key)) return emoji
  }

  // Category fallback
  if (category) {
    const catLower = category.toLowerCase()
    if (CATEGORY_FALLBACK[catLower]) return CATEGORY_FALLBACK[catLower]
  }

  return '🍽️'
}
