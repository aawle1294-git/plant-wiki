import os
import json
import logging
from typing import Dict, Any, List
from collections import defaultdict

logger = logging.getLogger("plant_wiki.memory")

MEMORY_DB_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "memory_db.json")

def _load_memory():
    if os.path.exists(MEMORY_DB_FILE):
        try:
            with open(MEMORY_DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_memory():
    data = {
        "MEMORY_HISTORY": dict(MEMORY_HISTORY),
        "MEMORY_PROFILES": MEMORY_PROFILES,
        "MEMORY_LEAF_TX": dict(MEMORY_LEAF_TX),
        "MEMORY_WATERING_SCHEDULES": dict(MEMORY_WATERING_SCHEDULES),
    }
    try:
        with open(MEMORY_DB_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save memory db: {e}")

_mem_data = _load_memory()

def _convert_to_defaultdict(data, default_factory):
    d = defaultdict(default_factory)
    if data:
        for k, v in data.items():
            d[k] = v
    return d

MEMORY_HISTORY: Dict[str, List[Dict[str, Any]]] = _convert_to_defaultdict(_mem_data.get("MEMORY_HISTORY", {}), list)
MEMORY_PROFILES: Dict[str, Dict[str, Any]] = _mem_data.get("MEMORY_PROFILES", {})
MEMORY_LEAF_TX: Dict[str, List[Dict[str, Any]]] = _convert_to_defaultdict(_mem_data.get("MEMORY_LEAF_TX", {}), list)
MEMORY_WATERING_SCHEDULES: Dict[str, List[Dict[str, Any]]] = _convert_to_defaultdict(_mem_data.get("MEMORY_WATERING_SCHEDULES", {}), list)
