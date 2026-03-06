"""
Recipe URL/text ingest workflow using LangGraph.

This graph parses recipe URLs, text, or transcripts into
structured recipe card proposals.
"""

import logging
from uuid import uuid4

import httpx
from langgraph.graph import StateGraph, END

from bubbly_chef.config import settings
from bubbly_chef.models.base import ProposalEnvelope
from bubbly_chef.models.recipe import Ingredient, RecipeCard, RecipeCardProposal
from bubbly_chef.tools.llm_client import get_ollama_client, LLMError
from bubbly_chef.workflows.state import (
    WorkflowState,
    LLMRecipeResult,
    create_recipe_envelope,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Extended State for Recipe Workflow
# =============================================================================

class RecipeWorkflowState(WorkflowState):
    """Extended state for recipe ingest workflow."""
    url: str | None
    caption: str | None
    fetched_content: str | None
    recipe: RecipeCard | None


# =============================================================================
# LLM Prompts
# =============================================================================

RECIPE_PARSE_SYSTEM_PROMPT = """You are a helpful assistant that extracts structured recipe information from text.

Given recipe text (from a webpage or transcript), extract:
1. Recipe title
2. Description
3. Timing (prep, cook, total)
4. Servings
5. Ingredients with quantities and units
6. Step-by-step instructions
7. Additional metadata (cuisine, meal type, dietary tags, difficulty, tips)

Be thorough but accurate. Only include information that's actually present in the text."""


RECIPE_PARSE_USER_PROMPT_TEMPLATE = """Parse the following recipe text into a structured recipe:

{text}

{caption_hint}

Extract:
- title: recipe name
- description: brief description
- prep_time_minutes, cook_time_minutes, total_time_minutes: timing info
- servings: number of servings
- ingredients: list of {{name, quantity, unit, preparation, optional}}
- instructions: list of steps as strings
- cuisine: cuisine type if mentioned
- meal_type: breakfast/lunch/dinner/snack
- dietary_tags: vegan, vegetarian, gluten-free, etc.
- difficulty: easy/medium/hard
- tips: cooking tips if provided
- confidence: 0-1 based on how complete the recipe info is"""


# =============================================================================
# Graph Nodes
# =============================================================================

async def fetch_url(state: RecipeWorkflowState) -> RecipeWorkflowState:
    """
    Node: Fetch content from URL if provided.
    
    This is a stub - in production you'd use a proper web scraper
    with recipe schema extraction (JSON-LD, etc.)
    """
    url = state.get("url")
    
    if not url:
        return {
            **state,
            "fetched_content": None,
        }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, follow_redirects=True)
            response.raise_for_status()
            
            # Get text content (very basic - just HTML text)
            content = response.text
            
            # In production, you'd parse HTML and extract recipe schema
            # For now, just grab text content
            
            # Very basic HTML text extraction (placeholder)
            import re
            # Remove script and style content
            content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
            content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL | re.IGNORECASE)
            # Remove HTML tags
            content = re.sub(r'<[^>]+>', ' ', content)
            # Clean up whitespace
            content = re.sub(r'\s+', ' ', content).strip()
            
            # Truncate if too long
            if len(content) > 10000:
                content = content[:10000] + "..."
            
            logger.info(f"Fetched {len(content)} chars from {url}")
            
            return {
                **state,
                "fetched_content": content,
            }
            
    except Exception as e:
        logger.warning(f"Failed to fetch URL {url}: {e}")
        return {
            **state,
            "fetched_content": None,
            "warnings": state.get("warnings", []) + [f"Could not fetch URL: {e}"],
        }


async def parse_recipe_llm(state: RecipeWorkflowState) -> RecipeWorkflowState:
    """
    Node: Parse recipe text using LLM.
    """
    # Get text from fetched content or input
    text = state.get("fetched_content") or state.get("input_text", "")
    caption = state.get("caption", "")
    
    if not text.strip():
        return {
            **state,
            "parse_error": "No recipe text to parse",
            "confidence": 0.0,
            "errors": state.get("errors", []) + ["No recipe content available"],
        }
    
    llm = get_ollama_client()
    
    caption_hint = f"Hint from user: {caption}" if caption else ""
    prompt = RECIPE_PARSE_USER_PROMPT_TEMPLATE.format(
        text=text[:5000],  # Limit input size
        caption_hint=caption_hint,
    )
    
    try:
        result, error = await llm.generate_structured(
            prompt=prompt,
            response_model=LLMRecipeResult,
            system_prompt=RECIPE_PARSE_SYSTEM_PROMPT,
            temperature=0.1,
        )
        
        if error or result is None:
            logger.warning(f"LLM recipe parse error: {error}")
            return {
                **state,
                "parse_error": error or "No result from LLM",
                "confidence": 0.0,
                "errors": state.get("errors", []) + [f"Could not parse recipe: {error}"],
            }
        
        # Convert to RecipeCard
        ingredients = []
        for ing_data in result.ingredients:
            if isinstance(ing_data, dict):
                ingredients.append(Ingredient(
                    name=ing_data.get("name", "unknown"),
                    quantity=ing_data.get("quantity"),
                    unit=ing_data.get("unit"),
                    preparation=ing_data.get("preparation"),
                    optional=ing_data.get("optional", False),
                ))
        
        # Calculate total time if not provided
        total_time = result.total_time_minutes
        if not total_time and (result.prep_time_minutes or result.cook_time_minutes):
            total_time = (result.prep_time_minutes or 0) + (result.cook_time_minutes or 0)
        
        recipe = RecipeCard(
            id=uuid4(),
            title=result.title,
            description=result.description,
            source_url=state.get("url"),
            prep_time_minutes=result.prep_time_minutes,
            cook_time_minutes=result.cook_time_minutes,
            total_time_minutes=total_time,
            servings=result.servings,
            ingredients=ingredients,
            instructions=result.instructions,
            cuisine=result.cuisine,
            meal_type=result.meal_type,
            dietary_tags=result.dietary_tags,
            difficulty=result.difficulty,
            tips=result.tips,
        )
        
        logger.info(f"Parsed recipe: {recipe.title} with {len(ingredients)} ingredients")
        
        return {
            **state,
            "recipe": recipe,
            "confidence": result.confidence,
        }
        
    except LLMError as e:
        logger.error(f"LLM error: {e}")
        return {
            **state,
            "parse_error": str(e),
            "confidence": 0.0,
            "errors": state.get("errors", []) + [f"LLM error: {e}"],
        }


def validate_recipe(state: RecipeWorkflowState) -> RecipeWorkflowState:
    """
    Node: Validate the parsed recipe (deterministic).
    """
    recipe = state.get("recipe")
    warnings = state.get("warnings", [])
    errors = state.get("errors", [])
    confidence = state.get("confidence", 0.0)
    
    if not recipe:
        return {
            **state,
            "requires_review": True,
        }
    
    # Validation checks
    if not recipe.title or len(recipe.title) < 3:
        errors.append("Recipe title is missing or too short")
        confidence *= 0.5
    
    if not recipe.ingredients:
        errors.append("No ingredients found")
        confidence *= 0.5
    
    if not recipe.instructions:
        errors.append("No instructions found")
        confidence *= 0.5
    
    if len(recipe.ingredients) < 2:
        warnings.append("Very few ingredients - recipe may be incomplete")
        confidence *= 0.8
    
    if len(recipe.instructions) < 2:
        warnings.append("Very few instructions - recipe may be incomplete")
        confidence *= 0.8
    
    # Check for reasonable timing
    if recipe.total_time_minutes and recipe.total_time_minutes > 480:  # 8 hours
        warnings.append("Recipe time seems unusually long")
    
    requires_review = (
        confidence < settings.auto_apply_confidence_threshold
        or len(errors) > 0
    )
    
    return {
        **state,
        "warnings": warnings,
        "errors": errors,
        "confidence": confidence,
        "requires_review": requires_review,
    }


# =============================================================================
# Graph Construction
# =============================================================================

def build_recipe_ingest_graph() -> StateGraph:
    """Build the recipe ingest LangGraph workflow."""
    
    workflow = StateGraph(RecipeWorkflowState)
    
    # Add nodes
    workflow.add_node("fetch_url", fetch_url)
    workflow.add_node("parse_recipe", parse_recipe_llm)
    workflow.add_node("validate", validate_recipe)
    
    # Define edges
    workflow.set_entry_point("fetch_url")
    workflow.add_edge("fetch_url", "parse_recipe")
    workflow.add_edge("parse_recipe", "validate")
    workflow.add_edge("validate", END)
    
    return workflow


# Compiled graph
recipe_ingest_graph = build_recipe_ingest_graph().compile()


async def run_recipe_ingest(
    url: str | None = None,
    text: str | None = None,
    caption: str | None = None,
) -> ProposalEnvelope[RecipeCardProposal]:
    """
    Run the recipe ingest workflow and return a proposal envelope.
    
    Args:
        url: Recipe URL to fetch and parse
        text: Recipe text/transcript to parse
        caption: Optional caption/title hint
        
    Returns:
        ProposalEnvelope containing the recipe card proposal
    """
    initial_state: RecipeWorkflowState = {
        "input_text": text or "",
        "input_type": "recipe",
        "url": url,
        "caption": caption,
        "fetched_content": None,
        "recipe": None,
        "parsed_items": [],
        "normalized_items": [],
        "actions": [],
        "warnings": [],
        "errors": [],
        "confidence": 0.0,
        "field_confidences": {},
        "requires_review": True,
    }
    
    # Run the graph
    final_state = await recipe_ingest_graph.ainvoke(initial_state)
    
    # Build proposal
    recipe = final_state.get("recipe")
    
    if not recipe:
        # Create empty recipe for error case
        recipe = RecipeCard(
            id=uuid4(),
            title="Unknown Recipe",
        )
    
    proposal = RecipeCardProposal(
        recipe=recipe,
        source_url=url,
        source_text=text,
    )
    
    return create_recipe_envelope(
        proposal=proposal,
        confidence=final_state.get("confidence", 0.0),
        field_confidences=final_state.get("field_confidences", {}),
        warnings=final_state.get("warnings", []),
        errors=final_state.get("errors", []),
    )
