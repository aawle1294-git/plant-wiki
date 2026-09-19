import logging
from typing import Optional
from supabase import create_client
from app.core.config import SUPABASE_URL, SUPABASE_KEY

logger = logging.getLogger("plant_wiki.db")

sb_client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        sb_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info(f"Supabase client bound: {SUPABASE_URL}")
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")
        sb_client = None

def get_supabase():
    return sb_client

def require_supabase():
    if not sb_client:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="Supabase 설정이 안 되어 있습니다.")

def user_client(token: str):
    """Create a Supabase client with the user's JWT token attached."""
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    try:
        client.postgrest.auth(token)
    except Exception as e:
        logger.warning("postgrest auth attach failed: %s", e)
    return client
