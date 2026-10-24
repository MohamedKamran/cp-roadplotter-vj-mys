"""Central settings. Every value can be overridden with an environment variable
of the same name prefixed with POTHOLE_ (e.g. POTHOLE_CONF_THRESHOLD=0.5)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _env(name, default, cast=str):
    raw = os.environ.get(f"POTHOLE_{name}")
    if raw is None:
        return default
    if cast is bool:
        return raw.lower() in ("1", "true", "yes", "on")
    return cast(raw)


class Settings:
    # --- paths ---
    DATA_DIR = Path(_env("DATA_DIR", str(ROOT / "data")))
    DB_PATH = Path(_env("DB_PATH", str(ROOT / "data" / "pothole.db")))
    PHOTOS_DIR = Path(_env("PHOTOS_DIR", str(ROOT / "data" / "photos")))
    WEB_DIR = ROOT / "web"
    NOTEBOOK_DIR = ROOT / "notebooks"
    RUNS_DIR = ROOT / "data" / "runs"

    # --- detection model ---
    # First existing file wins. CoreML (.mlpackage) is fastest on Apple Silicon.
    # setup.sh downloads a pretrained YOLOv8m pothole model (HRP4K) into models/pothole.pt
    MODEL_CANDIDATES = [
        _env("MODEL_PATH", ""),
        str(ROOT / "models" / "pothole.mlpackage"),
        str(ROOT / "models" / "pothole.pt"),
    ]
    MOCK_DETECTOR = _env("MOCK", False, bool)   # fake detections for UI testing
    CONF_THRESHOLD = _env("CONF_THRESHOLD", 0.30, float)
    # the pretrained model was trained on 4K frames at 1536 px; potholes vanish at 640
    IMG_SIZE = _env("IMG_SIZE", 1280, int)

    # --- camera defaults (scanner app can override per device) ---
    DEFAULT_CAMERA_HEIGHT_M = _env("CAMERA_HEIGHT_M", 1.2, float)
    DEFAULT_CAMERA_TILT_DEG = _env("CAMERA_TILT_DEG", 8.0, float)
    DEFAULT_HFOV_DEG = _env("HFOV_DEG", 66.0, float)

    # --- post-processing ---
    MERGE_RADIUS_M = _env("MERGE_RADIUS_M", 5.0, float)
    MAX_DETECTION_DIST_M = _env("MAX_DETECTION_DIST_M", 25.0, float)
    GONE_REPORTS_TO_CLOSE = _env("GONE_REPORTS_TO_CLOSE", 2, int)

    # --- local SLM (Ollama) ---
    OLLAMA_URL = _env("OLLAMA_URL", "http://localhost:11434")
    SLM_MODEL = _env("SLM_MODEL", "qwen3-vl:4b")

    # --- routing ---
    OSRM_URL = _env("OSRM_URL", "https://router.project-osrm.org")
    ROUTE_BUFFER_M = _env("ROUTE_BUFFER_M", 15.0, float)

    @property
    def model_path(self):
        for p in self.MODEL_CANDIDATES:
            if p and Path(p).exists():
                return Path(p)
        return None


settings = Settings()
