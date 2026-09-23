import os
from pathlib import Path

# Load .env fallback if present
def _load_dotenv():
    # 기본 경로는 프로젝트 루트의 .env, Render 배포 환경에서는 /etc/secrets/.env
    env_paths = [Path(__file__).parent.parent.parent / ".env", Path("/etc/secrets/.env")]
    for env_path in env_paths:
        if env_path.exists():
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip() and not line.startswith("#"):
                        key, *val_parts = line.split("=")
                        if val_parts:
                            value = "=".join(val_parts)
                            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
            break  # 파일을 찾아서 로드했으면 중단

_load_dotenv()

DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "").strip()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
