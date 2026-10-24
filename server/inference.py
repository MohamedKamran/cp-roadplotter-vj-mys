"""Inference engine. Loads the pothole model (pretrained YOLOv8m, or your own) once and runs it on JPEG frames.

Priority: CoreML (.mlpackage, uses the Neural Engine) > PyTorch .pt on MPS > CPU.
With POTHOLE_MOCK=1 (or no model file) it returns fake boxes so the apps can be
tested before training is done."""
import io
import logging
import random
import threading
import time

from PIL import Image

from .config import settings

log = logging.getLogger("pothole.inference")


class Detector:
    def __init__(self):
        self.lock = threading.Lock()   # one model, one frame at a time
        self.model = None
        self.mode = "mock"
        self.device = None
        path = settings.model_path
        if settings.MOCK_DETECTOR or path is None:
            if path is None and not settings.MOCK_DETECTOR:
                log.warning("No trained model found in models/ -> running in MOCK mode. "
                            "Run scripts/download_pretrained.py (or ./setup.sh) to get one.")
            return
        from ultralytics import YOLO  # imported lazily so mock mode needs no torch

        self.model = YOLO(str(path), task="detect")
        if path.suffix == ".pt":
            import torch
            self.device = "mps" if torch.backends.mps.is_available() else "cpu"
            self.mode = f"pytorch-{self.device}"
        else:
            self.mode = "coreml"
        log.info("Loaded %s (%s)", path.name, self.mode)
        # warm-up so the first real frame is not slow
        self.predict(Image.new("RGB", (settings.IMG_SIZE, settings.IMG_SIZE)))

    @staticmethod
    def decode(jpeg_bytes: bytes) -> Image.Image:
        return Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")

    def predict(self, image: Image.Image):
        """Returns (boxes, ms). boxes: [{x1,y1,x2,y2,conf}] in the image's pixels."""
        t0 = time.perf_counter()
        if self.model is None:
            boxes = self._mock(image)
        else:
            with self.lock:
                kw = dict(imgsz=settings.IMG_SIZE, conf=settings.CONF_THRESHOLD, verbose=False)
                if self.device:
                    kw["device"] = self.device
                result = self.model.predict(image, **kw)[0]
            boxes = []
            for xyxy, conf in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist()):
                x1, y1, x2, y2 = xyxy
                boxes.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2, "conf": round(conf, 3)})
        return boxes, round((time.perf_counter() - t0) * 1000, 1)

    @staticmethod
    def _mock(image):
        # roughly one frame in eight "sees" a pothole in the lower-middle of the frame
        if random.random() > 0.12:
            return []
        w, h = image.size
        cx = w * random.uniform(0.35, 0.65)
        cy = h * random.uniform(0.62, 0.85)
        bw, bh = w * random.uniform(0.06, 0.16), h * random.uniform(0.03, 0.07)
        return [{"x1": cx - bw / 2, "y1": cy - bh / 2, "x2": cx + bw / 2, "y2": cy + bh / 2,
                 "conf": round(random.uniform(0.5, 0.9), 3)}]


_detector = None


def get_detector() -> Detector:
    global _detector
    if _detector is None:
        _detector = Detector()
    return _detector
