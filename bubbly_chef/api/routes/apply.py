"""Apply endpoint for applying reviewed proposals."""

import logging
from datetime import date, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException

from bubbly_chef.models.requests import ApplyRequest, ApplyResponse
from bubbly_chef.models.pantry import (
    ActionType,
    FoodCategory,
    PantryItem,
    PantryUpsertAction,
    StorageLocation,
)
from bubbly_chef.models.recipe import Ingredient, RecipeCard
from bubbly_chef.repository.sqlite import get_repository

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Apply"])


def parse_pantry_item(item_data: dict) -> PantryItem:
    """Parse a dictionary into a PantryItem."""
    # Handle UUID
    item_id = item_data.get("id")
    if isinstance(item_id, str):
        item_id = UUID(item_id)
    elif item_id is None:
        item_id = uuid4()
    
    # Handle category
    category = item_data.get("category", "other")
    if isinstance(category, str):
        try:
            category = FoodCategory(category)
        except ValueError:
            category = FoodCategory.OTHER
    
    # Handle storage location
    storage = item_data.get("storage_location", "pantry")
    if isinstance(storage, str):
        try:
            storage = StorageLocation(storage)
        except ValueError:
            storage = StorageLocation.PANTRY
    
    # Handle dates
    purchase_date = item_data.get("purchase_date")
    if isinstance(purchase_date, str):
        purchase_date = date.fromisoformat(purchase_date)
    
    expiry_date = item_data.get("expiry_date")
    if isinstance(expiry_date, str):
        expiry_date = date.fromisoformat(expiry_date)
    
    return PantryItem(
        id=item_id,
        name=item_data.get("name", "unknown"),
        original_name=item_data.get("original_name"),
        category=category,
        storage_location=storage,
        quantity=item_data.get("quantity", 1.0),
        unit=item_data.get("unit", "item"),
        brand=item_data.get("brand"),
        barcode=item_data.get("barcode"),
        purchase_date=purchase_date,
        expiry_date=expiry_date,
        estimated_expiry=item_data.get("estimated_expiry", True),
        notes=item_data.get("notes"),
    )


@router.post(
    "/apply",
    response_model=ApplyResponse,
    summary="Apply a reviewed proposal",
)
async def apply_proposal(request: ApplyRequest) -> ApplyResponse:
    """
    Apply a reviewed (and possibly modified) proposal to the database.
    
    This endpoint is the human-in-the-loop checkpoint where the UI
    sends back the approved proposal for actual state mutation.
    
    The operation is idempotent - reapplying the same proposal
    will update existing items rather than create duplicates.
    """
    logger.info(f"Apply request: {request.request_id}, intent={request.intent}")
    
    repo = await get_repository()
    
    applied_count = 0
    failed_count = 0
    errors: list[str] = []
    affected_ids: list[UUID] = []
    
    try:
        if request.intent == "pantry_update":
            # Apply pantry actions
            actions_data = request.proposal.get("actions", [])
            
            for action_data in actions_data:
                try:
                    action_type_str = action_data.get("action_type", "add")
                    try:
                        action_type = ActionType(action_type_str)
                    except ValueError:
                        action_type = ActionType.ADD
                    
                    item_data = action_data.get("item", {})
                    item = parse_pantry_item(item_data)
                    
                    if action_type == ActionType.ADD:
                        # Check for existing similar item (dedup)
                        existing = await repo.find_similar_item(item.name)
                        if existing:
                            # Update quantity instead of adding new
                            existing.quantity += item.quantity
                            existing.updated_at = datetime.utcnow()
                            await repo.update_pantry_item(existing)
                            affected_ids.append(existing.id)
                            logger.info(f"Updated existing item: {existing.name}")
                        else:
                            await repo.add_pantry_item(item)
                            affected_ids.append(item.id)
                            logger.info(f"Added new item: {item.name}")
                        applied_count += 1
                        
                    elif action_type == ActionType.UPDATE:
                        # Find and update the item
                        match_id = action_data.get("match_existing_id")
                        if match_id:
                            if isinstance(match_id, str):
                                match_id = UUID(match_id)
                            existing = await repo.get_pantry_item(match_id)
                            if existing:
                                # Update fields from the action
                                for field in ["name", "quantity", "unit", "category", 
                                             "storage_location", "expiry_date", "notes"]:
                                    if field in item_data:
                                        setattr(existing, field, getattr(item, field))
                                existing.updated_at = datetime.utcnow()
                                await repo.update_pantry_item(existing)
                                affected_ids.append(existing.id)
                                applied_count += 1
                            else:
                                errors.append(f"Item {match_id} not found for update")
                                failed_count += 1
                        else:
                            # No match ID, try to find by name
                            existing = await repo.find_similar_item(item.name)
                            if existing:
                                existing.quantity = item.quantity
                                existing.updated_at = datetime.utcnow()
                                await repo.update_pantry_item(existing)
                                affected_ids.append(existing.id)
                                applied_count += 1
                            else:
                                errors.append(f"No existing item found to update: {item.name}")
                                failed_count += 1
                                
                    elif action_type == ActionType.REMOVE:
                        # Delete the item
                        match_id = action_data.get("match_existing_id")
                        if match_id:
                            if isinstance(match_id, str):
                                match_id = UUID(match_id)
                            deleted = await repo.delete_pantry_item(match_id)
                            if deleted:
                                applied_count += 1
                            else:
                                errors.append(f"Item {match_id} not found for removal")
                                failed_count += 1
                        else:
                            # Try to find by name
                            existing = await repo.find_similar_item(item.name)
                            if existing:
                                await repo.delete_pantry_item(existing.id)
                                applied_count += 1
                            else:
                                errors.append(f"No item found to remove: {item.name}")
                                failed_count += 1
                                
                    elif action_type == ActionType.USE:
                        # Reduce quantity
                        match_id = action_data.get("match_existing_id")
                        existing = None
                        
                        if match_id:
                            if isinstance(match_id, str):
                                match_id = UUID(match_id)
                            existing = await repo.get_pantry_item(match_id)
                        else:
                            existing = await repo.find_similar_item(item.name)
                        
                        if existing:
                            existing.quantity -= item.quantity
                            if existing.quantity <= 0:
                                # Remove if quantity is zero or negative
                                await repo.delete_pantry_item(existing.id)
                                logger.info(f"Removed depleted item: {existing.name}")
                            else:
                                existing.updated_at = datetime.utcnow()
                                await repo.update_pantry_item(existing)
                                affected_ids.append(existing.id)
                            applied_count += 1
                        else:
                            errors.append(f"No item found to use: {item.name}")
                            failed_count += 1
                            
                except Exception as e:
                    logger.error(f"Failed to apply action: {e}")
                    errors.append(f"Action failed: {e}")
                    failed_count += 1
                    
        elif request.intent == "recipe_card":
            # Apply recipe
            recipe_data = request.proposal.get("recipe", {})
            
            try:
                # Parse recipe
                recipe_id = recipe_data.get("id")
                if isinstance(recipe_id, str):
                    recipe_id = UUID(recipe_id)
                elif recipe_id is None:
                    recipe_id = uuid4()
                
                ingredients = []
                for ing_data in recipe_data.get("ingredients", []):
                    ingredients.append(Ingredient(
                        name=ing_data.get("name", ""),
                        quantity=ing_data.get("quantity"),
                        unit=ing_data.get("unit"),
                        preparation=ing_data.get("preparation"),
                        optional=ing_data.get("optional", False),
                    ))
                
                recipe = RecipeCard(
                    id=recipe_id,
                    title=recipe_data.get("title", "Untitled Recipe"),
                    description=recipe_data.get("description"),
                    source_url=recipe_data.get("source_url"),
                    image_url=recipe_data.get("image_url"),
                    prep_time_minutes=recipe_data.get("prep_time_minutes"),
                    cook_time_minutes=recipe_data.get("cook_time_minutes"),
                    total_time_minutes=recipe_data.get("total_time_minutes"),
                    servings=recipe_data.get("servings"),
                    ingredients=ingredients,
                    instructions=recipe_data.get("instructions", []),
                    cuisine=recipe_data.get("cuisine"),
                    meal_type=recipe_data.get("meal_type"),
                    dietary_tags=recipe_data.get("dietary_tags", []),
                    difficulty=recipe_data.get("difficulty"),
                    tips=recipe_data.get("tips", []),
                    notes=recipe_data.get("notes"),
                )
                
                # Check if exists
                existing = await repo.get_recipe(recipe_id)
                if existing:
                    recipe.created_at = existing.created_at
                    await repo.update_recipe(recipe)
                else:
                    await repo.add_recipe(recipe)
                
                affected_ids.append(recipe_id)
                applied_count += 1
                logger.info(f"Applied recipe: {recipe.title}")
                
            except Exception as e:
                logger.error(f"Failed to apply recipe: {e}")
                errors.append(f"Recipe apply failed: {e}")
                failed_count += 1
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown intent: {request.intent}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Apply failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    
    success = applied_count > 0 and failed_count == 0
    
    return ApplyResponse(
        request_id=request.request_id,
        success=success,
        applied_count=applied_count,
        failed_count=failed_count,
        errors=errors,
        affected_item_ids=affected_ids,
    )
