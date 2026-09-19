import os
from pathlib import Path

# Load .env fallback if present
def _load_dotenv():
    env_path = Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip() and not line.startswith("#"):
                    key, *val_parts = line.split("=")
                    if val_parts:
                        value = "=".join(val_parts)
                        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

_load_dotenv()

DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "").strip()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
