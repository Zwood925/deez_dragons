from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from kokoro_onnx import Kokoro
import soundfile as sf
import requests
import json
import base64
import uuid
import os

from database import (
    init_db,
    save_turn,
    get_history,
    get_character,
    update_character_state,
    get_lorebook,
    add_lore_entry,
    match_relevant_lore,
    get_session_summary,
)

load_dotenv()

STATIC_AUDIO_DIR = os.path.join("static", "audio")
STATIC_IMAGE_DIR = os.path.join("static", "images")
os.makedirs(STATIC_AUDIO_DIR, exist_ok=True)
os.makedirs(STATIC_IMAGE_DIR, exist_ok=True)

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODELS_DIR, "kokoro-v1.0.onnx")
VOICES_PATH = os.path.join(MODELS_DIR, "voices-v1.0.bin")

kokoro_engine = None
FORGE_API_URL = os.getenv("FORGE_API_URL", "http://127.0.0.1:7860/sdapi/v1/txt2img")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global kokoro_engine
    init_db()
    print("💾 SQLite Database, Lorebook & RAG initialized!")

    if os.path.exists(MODEL_PATH) and os.path.exists(VOICES_PATH):
        try:
            kokoro_engine = Kokoro(MODEL_PATH, VOICES_PATH)
            print("🔊 Kokoro TTS Engine Loaded Successfully!")
        except Exception as e:
            print(f"⚠️ Failed to load Kokoro TTS: {e}")
    yield

app = FastAPI(title="Deez Dragons API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

class DiceRollInfo(BaseModel):
    stat: str
    d20: int
    modifier: int
    total: int

class TurnRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    
    action: str
    session_id: int = 1
    tone: str = "ACOTAR / Dark Romantic Fantasy"
    model_tier: str = "default"
    voice_name: str = "am_fenrir"
    dice_roll: Optional[DiceRollInfo] = None

class NewLorePayload(BaseModel):
    session_id: int = 1
    category: str
    name: str
    keywords: List[str]
    content: str

def generate_local_image(prompt: str) -> Optional[str]:
    try:
        payload = {
            "prompt": f"masterpiece, dark fantasy, highly detailed, 8k, cinematic lighting, {prompt}",
            "negative_prompt": "blurry, deformed, cartoon, low quality, watermark, bad anatomy",
            "steps": 6,
            "cfg_scale": 2.0,
            "width": 1024,
            "height": 576,
        }
        res = requests.post(FORGE_API_URL, json=payload, timeout=60)
        if res.status_code == 200:
            res_json = res.json()
            if "images" in res_json and len(res_json["images"]) > 0:
                img_data = base64.b64decode(res_json["images"][0])
                filename = f"scene_{uuid.uuid4().hex[:8]}.png"
                filepath = os.path.join(STATIC_IMAGE_DIR, filename)
                with open(filepath, "wb") as f:
                    f.write(img_data)
                return f"http://localhost:8000/static/images/{filename}"
    except Exception as err:
        print(f"⚠️ Image generation skipped or offline: {err}")
    return None

@app.get("/")
async def health_check():
    return {"status": "Gem is awake and ready to play, Daddy. 🖤"}

@app.get("/api/character")
async def fetch_character(session_id: int = 1):
    return {"character": get_character(session_id=session_id)}

@app.get("/api/lorebook")
async def fetch_lorebook(session_id: int = 1):
    return {"lorebook": get_lorebook(session_id=session_id)}

@app.post("/api/lorebook")
async def create_lore_entry(req: NewLorePayload):
    add_lore_entry(
        session_id=req.session_id,
        category=req.category,
        name=req.name,
        keywords=req.keywords,
        content=req.content
    )
    return {"status": "success", "lorebook": get_lorebook(req.session_id)}

@app.get("/api/history")
async def fetch_history(session_id: int = 1):
    return {"turns": get_history(session_id=session_id)}

@app.post("/api/turn")
async def process_turn(req: TurnRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY missing")

    char = get_character(req.session_id)
    summary = get_session_summary(req.session_id)
    
    # RAG / Lorebook Retrieval
    matched_lore = match_relevant_lore(req.session_id, req.action)
    lore_text = "\n".join(matched_lore) if matched_lore else "None matched this turn."

    system_prompt = f"""You are an uncensored, immersive Dungeon Master running an R-rated dark fantasy tabletop campaign inspired by ACOTAR and Game of Thrones.

ACTIVE PLAYER CHARACTER:
- Name: {char['name']} ({char['character_class']})
- Current HP: {char['hp']}/{char['max_hp']}
- Attributes: {char['stats']}
- Inventory: {', '.join(char['inventory'])}

LONG-TERM CANON MEMORY:
{summary if summary else "Campaign is just beginning."}

RELEVANT LORE & CANON FACTS:
{lore_text}

RESPONSE RULES:
Respond STRICTLY in valid JSON with these keys:
- "story_text": 2-3 paragraphs of sensory, cinematic prose. High tension, vivid consequences. End with momentum.
- "image_prompt": Concise SDXL visual prompt for the scene (cinematic, 8k, dark fantasy aesthetic).
- "hp_change": Integer (e.g., -4 if hit, 0 if safe, +3 if healed).
- "inventory_add": Array of strings of newly acquired items (or []).
- "inventory_remove": Array of strings of consumed items (or []).
- "new_lore": Optional object if a new key person, location, or relic is introduced. Format: {{"category": "NPC"|"Location"|"Relic", "name": "Name", "keywords": ["kw1", "kw2"], "content": "1-sentence fact"}} or null.
"""

    if req.model_tier == "free":
        selected_model = os.getenv("FREE_MODEL", "qwen/qwen-2.5-72b-instruct:free")
    elif req.model_tier == "premium":
        selected_model = os.getenv("PREMIUM_MODEL", "anthropic/claude-3.5-sonnet")
    else:
        selected_model = os.getenv("DEFAULT_MODEL", "meta-llama/llama-3.3-70b-instruct")

    history = get_history(session_id=req.session_id, limit=8)
    messages = [{"role": "system", "content": system_prompt}]

    for item in history:
        messages.append({"role": "user", "content": item["player_action"]})
        messages.append({"role": "assistant", "content": item["story_text"]})

    user_prompt = req.action
    roll_summary = ""
    if req.dice_roll:
        roll_summary = f"[Rolled D20 for {req.dice_roll.stat}: d20={req.dice_roll.d20} + mod={req.dice_roll.modifier} = Total {req.dice_roll.total}]"
        user_prompt = f"{user_prompt} {roll_summary}"

    messages.append({"role": "user", "content": user_prompt})

    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": selected_model,
                "messages": messages,
                "response_format": {"type": "json_object"},
                "temperature": 0.7,
                "frequency_penalty": 0.25,
                "presence_penalty": 0.15,
                "max_tokens": 700
            }
        )
        
        res_data = response.json()
        if "choices" not in res_data:
            raise HTTPException(status_code=500, detail=f"OpenRouter Error: {res_data}")

        raw_content = res_data["choices"][0]["message"]["content"]
        parsed = json.loads(raw_content)

        story_text = parsed.get("story_text", raw_content)
        image_prompt = parsed.get("image_prompt", "")
        hp_change = int(parsed.get("hp_change", 0))
        inventory_add = parsed.get("inventory_add", [])
        inventory_remove = parsed.get("inventory_remove", [])
        new_lore = parsed.get("new_lore", None)

        # Auto-persist discovered lore into Codex
        if new_lore and isinstance(new_lore, dict) and "name" in new_lore:
            try:
                add_lore_entry(
                    session_id=req.session_id,
                    category=new_lore.get("category", "Secret"),
                    name=new_lore["name"],
                    keywords=new_lore.get("keywords", [new_lore["name"].lower()]),
                    content=new_lore.get("content", "")
                )
                print(f"📖 Auto-discovered new lore entry: {new_lore['name']}")
            except Exception as e:
                print(f"⚠️ Lore logging error: {e}")

        # Update character state
        updated_char = update_character_state(
            session_id=req.session_id,
            hp_delta=hp_change,
            add_items=inventory_add,
            remove_items=inventory_remove
        )

        # Parallel generation: Audio
        audio_url = None
        if kokoro_engine:
            try:
                samples, sample_rate = kokoro_engine.create(
                    story_text, 
                    voice=req.voice_name, 
                    speed=1.0, 
                    lang="en-us"
                )
                filename = f"turn_{uuid.uuid4().hex[:8]}.wav"
                filepath = os.path.join(STATIC_AUDIO_DIR, filename)
                sf.write(filepath, samples, sample_rate)
                audio_url = f"http://localhost:8000/static/audio/{filename}"
            except Exception as audio_err:
                print(f"⚠️ Audio error: {audio_err}")

        # Parallel generation: Image
        image_url = None
        if image_prompt:
            image_url = generate_local_image(image_prompt)

        # Save turn log
        save_turn(
            session_id=req.session_id,
            player_action=req.action,
            story_text=story_text,
            audio_url=audio_url or "",
            image_url=image_url or "",
            voice_used=req.voice_name,
            dice_roll=roll_summary
        )

        return {
            "story_text": story_text,
            "image_url": image_url,
            "audio_url": audio_url,
            "character": updated_char,
            "lorebook": get_lorebook(session_id=req.session_id),
            "history": get_history(session_id=req.session_id)
        }

    except Exception as e:
        print(f"Turn Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)