"""Download a ready-trained pothole detector from Hugging Face into models/pothole.pt,
and on a Mac also export it to CoreML (models/pothole.mlpackage).

Default: dronefreak/hrp4k-yolov8m, YOLOv8m fine-tuned on HRP4K (perspective road
photos, single class "pothole"). Licence: AGPL-3.0.

    .venv/bin/python scripts/download_pretrained.py
    .venv/bin/python scripts/download_pretrained.py --repo <other HF repo> --file best.pt
    .venv/bin/python scripts/download_pretrained.py --no-coreml
"""
import argparse
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="dronefreak/hrp4k-yolov8m")
    ap.add_argument("--file", default="best.pt")
    ap.add_argument("--no-coreml", action="store_true", help="skip the CoreML export on a Mac")
    ap.add_argument("--force", action="store_true", help="download again even if models/pothole.pt exists")
    args = ap.parse_args()

    MODELS.mkdir(exist_ok=True)
    target = MODELS / "pothole.pt"
    if target.exists() and not args.force:
        print(f"{target} already exists (use --force to replace it).")
    else:
        from huggingface_hub import hf_hub_download
        print(f"Downloading {args.file} from {args.repo} ...")
        path = hf_hub_download(repo_id=args.repo, filename=args.file)
        shutil.copy2(path, target)
        print(f"Saved {target} ({target.stat().st_size / 1e6:.0f} MB)")

    # sanity check: it must be a detector that knows "pothole"
    from ultralytics import YOLO
    model = YOLO(str(target))
    names = list(model.names.values())
    print("Classes:", names)
    if not any("pothole" in str(n).lower() for n in names):
        print("Warning: this model has no 'pothole' class; the server will report whatever it detects.")
    (MODELS / "source.txt").write_text(f"{args.repo}/{args.file}\n")

    if platform.system() == "Darwin" and not args.no_coreml:
        print("Exporting to CoreML for the Neural Engine ...")
        subprocess.run([sys.executable, str(ROOT / "scripts" / "export_coreml.py")], check=True)
    print("Done. Restart the server to use the model.")


if __name__ == "__main__":
    main()
