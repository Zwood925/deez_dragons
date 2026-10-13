import os
import requests

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODELS_DIR, "kokoro-v1.0.onnx")
VOICES_PATH = os.path.join(MODELS_DIR, "voices-v1.0.bin")

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

def ensure_weights():
    os.makedirs(MODELS_DIR, exist_ok=True)
    for url, dest in [(MODEL_URL, MODEL_PATH), (VOICES_URL, VOICES_PATH)]:
        if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
            print(f"✅ {os.path.basename(dest)} already present.")
            continue
        print(f"⏳ Downloading {os.path.basename(dest)}...")
        res = requests.get(url, stream=True)
        with open(dest, "wb") as f:
            for chunk in res.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"✅ Downloaded {os.path.basename(dest)} successfully.")

if __name__ == "__main__":
    ensure_weights()