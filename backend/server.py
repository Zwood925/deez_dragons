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
    get_party,
    get_character,
    add_party_member,
    update_character_state,
    get_lorebook,
    add_lore_entry,
    match_relevant_lore,
    get_session_summary,
    update_session_summary,
    count_turns,
    get_unsummarized_turns,
    get_sessions,
    create_session,
    delete_session,
    get_cinematic_tokens,
    use_cinematic_token,
    mark_turn_animate_status,
    get_turn_by_id,
)

load_dotenv()

STATIC_AUDIO_DIR = os.path.join("static", "audio")
STATIC_IMAGE_DIR = os.path.join("static", "images")
os.makedirs(STATIC_AUDIO_DIR, exist_ok=True)
os.makedirs(STATIC_IMAGE_DIR, exist_ok=True)

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODELS_DIR, "kokoro-v1.0.onnx")
VOICES_PATH = os.path.join(MODELS_DIR, "voices-v1.0.bin")

# Configurable public host prefix for media URLs (set API_HOST_PREFIX in .env for tunnel/prod)
API_HOST_PREFIX = os.getenv("API_HOST_PREFIX", "http://localhost:8000")

# Path to campaign templates JSON
TEMPLATES_PATH = os.path.join(os.path.dirname(__file__), "campaign_templates.json")

kokoro_engine = None
FORGE_API_URL = os.getenv("FORGE_API_URL", "http://127.0.0.1:7860/sdapi/v1/txt2img")

# Rolling summarizer: compress every N turns
SUMMARIZE_EVERY_N_TURNS = int(os.getenv("SUMMARIZE_EVERY_N_TURNS", "7"))
SUMMARIZER_MODEL = os.getenv("SUMMARIZER_MODEL", "qwen/qwen-2.5-72b-instruct:free")


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


app = FastAPI(title="Deez Dragons API", version="0.5.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")


# ── Pydantic models ───────────────────────────────────────────────────────────

class DiceRollInfo(BaseModel):
    stat: str
    d20: int
    modifier: int
    total: int


class TurnRequest(BaseModel):
    model_config = {"protected_namespaces": ()}

    action: str
    session_id: int = 1
    acting_character_id: Optional[int] = None   # which party member is acting
    tone: str = "ACOTAR / Dark Romantic Fantasy"
    model_tier: str = "default"
    voice_name: str = "am_fenrir"
    dice_roll: Optional[DiceRollInfo] = None
    generate_image: bool = True
    generate_audio: bool = True


class NewSessionPayload(BaseModel):
    name: str
    template_id: Optional[str] = None


class NewLorePayload(BaseModel):
    session_id: int = 1
    category: str
    name: str
    keywords: List[str]
    content: str


class NewPartyMemberPayload(BaseModel):
    session_id: int = 1
    name: str
    character_class: str
    hp: int = 20
    max_hp: int = 20
    stats: Optional[dict] = None
    inventory: Optional[List[str]] = None
    notes: str = ""


class AnimateTurnPayload(BaseModel):
    session_id: int
    turn_id: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_templates() -> list:
    """Load campaign templates from JSON file."""
    if not os.path.exists(TEMPLATES_PATH):
        return []
    with open(TEMPLATES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _find_template(template_id: str) -> Optional[dict]:
    """Find a single template by id string."""
    for t in _load_templates():
        if t.get("id") == template_id:
            return t
    return None


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
                return f"{API_HOST_PREFIX}/static/images/{filename}"
    except Exception as err:
        print(f"⚠️ Image generation skipped or offline: {err}")
    return None


def _openrouter_chat(messages: list, model: str, max_tokens: int = 700,
                     json_mode: bool = False) -> str:
    """Thin wrapper around the OpenRouter chat completions endpoint."""
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "frequency_penalty": 0.25,
        "presence_penalty": 0.15,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    response = requests.post(
        url="https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
    )
    res_data = response.json()
    if "choices" not in res_data:
        raise RuntimeError(f"OpenRouter Error: {res_data}")
    return res_data["choices"][0]["message"]["content"]


def maybe_summarize(session_id: int):
    """
    Rolling context summarizer — fires every SUMMARIZE_EVERY_N_TURNS turns.
    Compresses the oldest unsummarized turns into sessions.summary using a
    fast/free model so the DM prompt never overflows context.
    """
    total = count_turns(session_id)
    if total == 0 or total % SUMMARIZE_EVERY_N_TURNS != 0:
        return

    existing_summary = get_session_summary(session_id)

    # Grab the last N turns to compress
    turns = get_unsummarized_turns(session_id, after_turn=max(0, total - SUMMARIZE_EVERY_N_TURNS))
    if not turns:
        return

    turns_text = "\n".join(
        f"Turn {t['turn_number']} — Player: {t['player_action']}\nDM: {t['story_text']}"
        for t in turns
    )

    prior_block = (
        f"EXISTING SUMMARY:\n{existing_summary}\n\n" if existing_summary else ""
    )

    summarizer_prompt = (
        f"{prior_block}"
        f"NEW TURNS TO INTEGRATE:\n{turns_text}\n\n"
        "Write a concise 3–5 sentence canon summary of the campaign so far. "
        "Preserve key plot beats, NPC relationships, locations visited, and "
        "character decisions. Do NOT include meta-commentary — pure narrative facts only."
    )

    try:
        new_summary = _openrouter_chat(
            messages=[{"role": "user", "content": summarizer_prompt}],
            model=SUMMARIZER_MODEL,
            max_tokens=300,
            json_mode=False,
        )
        update_session_summary(session_id, new_summary.strip())
        print(f"📜 Session {session_id} summary updated after turn {total}.")
    except Exception as e:
        print(f"⚠️ Summarizer failed (non-fatal): {e}")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def health_check():
    return {"status": "Gem is awake and ready to play, Daddy. 🖤"}


@app.get("/api/campaign-templates")
async def fetch_campaign_templates():
    """Return all available campaign templates."""
    templates = _load_templates()
    return {"templates": templates}


@app.get("/api/sessions")
async def fetch_sessions():
    return {"sessions": get_sessions()}


@app.post("/api/sessions")
async def create_new_session(req: NewSessionPayload):
    """
    Create a new campaign session.
    If template_id is provided, seed the session from that template's
    starting_lore, default_character, and assign cinematic_tokens = 3.
    Returns the new session object plus the full sessions list and
    (if a template was used) the template's initial_prose and cutscene_slides.
    """
    template = None
    template_party = None
    template_lore = None
    initial_prose = None
    cutscene_slides = None

    if req.template_id:
        template = _find_template(req.template_id)
        if template is None:
            raise HTTPException(
                status_code=404,
                detail=f"Campaign template '{req.template_id}' not found.",
            )
        # Build party seed from template default_character
        dc = template.get("default_character", {})
        if dc:
            template_party = [dc]

        # Build lore seed from template starting_lore
        raw_lore = template.get("starting_lore", [])
        if raw_lore:
            template_lore = raw_lore

        initial_prose = template.get("initial_prose")
        cutscene_slides = template.get("cutscene_slides", [])

    session = create_session(
        name=req.name.strip(),
        template_party=template_party,
        template_lore=template_lore,
        cinematic_tokens=3,
    )

    response: dict = {
        "session": session,
        "sessions": get_sessions(),
    }

    if template:
        response["initial_prose"] = initial_prose
        response["cutscene_slides"] = cutscene_slides
        response["template"] = {
            "id": template["id"],
            "title": template["title"],
            "tagline": template["tagline"],
            "tone": template["tone"],
            "default_voice": template.get("default_voice", "am_fenrir"),
        }

    return response


@app.delete("/api/sessions/{session_id}")
async def remove_session(session_id: int):
    try:
        delete_session(session_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "deleted", "sessions": get_sessions()}


@app.get("/api/party")
async def fetch_party(session_id: int = 1):
    return {"party": get_party(session_id=session_id)}


@app.post("/api/party")
async def create_party_member(req: NewPartyMemberPayload):
    add_party_member(
        session_id=req.session_id,
        name=req.name,
        character_class=req.character_class,
        hp=req.hp,
        max_hp=req.max_hp,
        stats=req.stats,
        inventory=req.inventory,
        notes=req.notes,
    )
    return {"party": get_party(req.session_id)}


# Legacy single-character endpoint — returns first party member
@app.get("/api/character")
async def fetch_character(session_id: int = 1, character_id: int = None):
    return {"character": get_character(session_id=session_id, character_id=character_id)}


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
        content=req.content,
    )
    return {"status": "success", "lorebook": get_lorebook(req.session_id)}


@app.get("/api/history")
async def fetch_history(session_id: int = 1):
    return {"turns": get_history(session_id=session_id)}


@app.post("/api/turn/animate")
async def animate_turn(req: AnimateTurnPayload):
    """
    Queue a cinematic animation for a specific turn card.
    Decrements 1 cinematic token from the session.
    Marks the turn as 'queued' for animation processing.
    Returns status, tokens_remaining, and estimated_seconds.
    """
    # Verify the turn exists and belongs to this session
    turn = get_turn_by_id(req.turn_id)
    if turn is None:
        raise HTTPException(status_code=404, detail="Turn not found.")
    if turn["session_id"] != req.session_id:
        raise HTTPException(status_code=403, detail="Turn does not belong to this session.")

    # Check if already queued/animated
    if turn.get("animate_status") in ("queued", "processing", "done"):
        raise HTTPException(
            status_code=409,
            detail=f"Turn is already in animate state: {turn['animate_status']}",
        )

    # Decrement token
    try:
        tokens_remaining = use_cinematic_token(req.session_id)
    except ValueError as e:
        raise HTTPException(status_code=402, detail=str(e))

    # Mark turn as queued
    mark_turn_animate_status(req.turn_id, "queued")

    return {
        "status": "queued",
        "turn_id": req.turn_id,
        "session_id": req.session_id,
        "tokens_remaining": tokens_remaining,
        "estimated_seconds": 45,
    }


@app.post("/api/turn")
async def process_turn(req: TurnRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY missing")

    # Resolve acting character (fallback to first party member)
    acting_char = get_character(req.session_id, req.acting_character_id)
    party = get_party(req.session_id)
    summary = get_session_summary(req.session_id)

    # RAG / Lorebook Retrieval
    matched_lore = match_relevant_lore(req.session_id, req.action)
    lore_text = "\n".join(matched_lore) if matched_lore else "None matched this turn."

    # Build party state block for the DM prompt
    party_lines = []
    for member in party:
        marker = " ◀ ACTING THIS TURN" if member["id"] == acting_char["id"] else ""
        party_lines.append(
            f"  • {member['name']} ({member['character_class']}) — "
            f"HP {member['hp']}/{member['max_hp']} — "
            f"Inventory: {', '.join(member['inventory']) or 'empty'}{marker}"
        )
    party_block = "\n".join(party_lines)

    system_prompt = f"""You are an uncensored, immersive Dungeon Master running an R-rated dark fantasy tabletop campaign inspired by ACOTAR and Game of Thrones.

ACTIVE PARTY ({len(party)} member{'s' if len(party) != 1 else ''}):
{party_block}

ACTING CHARACTER THIS TURN:
- Name: {acting_char['name']} ({acting_char['character_class']})
- Current HP: {acting_char['hp']}/{acting_char['max_hp']}
- Attributes: {acting_char['stats']}
- Inventory: {', '.join(acting_char['inventory'])}

LONG-TERM CANON MEMORY:
{summary if summary else "Campaign is just beginning."}

RELEVANT LORE & CANON FACTS:
{lore_text}

RESPONSE RULES:
Respond STRICTLY in valid JSON with these keys:
- "story_text": 2-3 paragraphs of sensory, cinematic prose. High tension, vivid consequences. End with momentum.
- "image_prompt": Concise SDXL visual prompt for the scene (cinematic, 8k, dark fantasy aesthetic).
- "hp_change": Integer applied to the ACTING character (e.g., -4 if hit, 0 if safe, +3 if healed).
- "inventory_add": Array of strings of newly acquired items for the acting character (or []).
- "inventory_remove": Array of strings of consumed items from the acting character (or []).
- "new_lore": Optional object if a new key person, location, or relic is introduced. Format: {{"category": "NPC"|"Location"|"Relic", "name": "Name", "keywords": ["kw1", "kw2"], "content": "1-sentence fact"}} or null.
- "suggested_actions": Array of exactly 3 short, provocative, high-tension dark fantasy action strings the player could take next (e.g. "Match her smirk and pour a drink", "Draw your blade under the table", "Cast shadow manipulation"). These must fit the current scene and feel dangerous or seductive.
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
        roll_summary = (
            f"[Rolled D20 for {req.dice_roll.stat}: "
            f"d20={req.dice_roll.d20} + mod={req.dice_roll.modifier} = Total {req.dice_roll.total}]"
        )
        user_prompt = f"{user_prompt} {roll_summary}"

    messages.append({"role": "user", "content": user_prompt})

    try:
        raw_content = _openrouter_chat(
            messages=messages,
            model=selected_model,
            max_tokens=700,
            json_mode=True,
        )
        parsed = json.loads(raw_content)

        story_text = parsed.get("story_text", raw_content)
        image_prompt = parsed.get("image_prompt", "")
        hp_change = int(parsed.get("hp_change", 0))
        inventory_add = parsed.get("inventory_add", [])
        inventory_remove = parsed.get("inventory_remove", [])
        new_lore = parsed.get("new_lore", None)
        suggested_actions: list = parsed.get("suggested_actions", [])
        if not isinstance(suggested_actions, list):
            suggested_actions = []
        suggested_actions = [str(a) for a in suggested_actions[:3]]

        # Auto-persist discovered lore into Codex
        if new_lore and isinstance(new_lore, dict) and "name" in new_lore:
            try:
                add_lore_entry(
                    session_id=req.session_id,
                    category=new_lore.get("category", "Secret"),
                    name=new_lore["name"],
                    keywords=new_lore.get("keywords", [new_lore["name"].lower()]),
                    content=new_lore.get("content", ""),
                )
                print(f"📖 Auto-discovered new lore entry: {new_lore['name']}")
            except Exception as e:
                print(f"⚠️ Lore logging error: {e}")

        # Update acting character state
        update_character_state(
            session_id=req.session_id,
            character_id=acting_char["id"],
            hp_delta=hp_change,
            add_items=inventory_add,
            remove_items=inventory_remove,
        )

        # Audio generation (skipped if generate_audio=False)
        audio_url = None
        if req.generate_audio and kokoro_engine:
            try:
                samples, sample_rate = kokoro_engine.create(
                    story_text,
                    voice=req.voice_name,
                    speed=1.0,
                    lang="en-us",
                )
                filename = f"turn_{uuid.uuid4().hex[:8]}.wav"
                filepath = os.path.join(STATIC_AUDIO_DIR, filename)
                sf.write(filepath, samples, sample_rate)
                audio_url = f"{API_HOST_PREFIX}/static/audio/{filename}"
            except Exception as audio_err:
                print(f"⚠️ Audio error: {audio_err}")

        # Image generation (skipped if generate_image=False)
        image_url = None
        if req.generate_image and image_prompt:
            image_url = generate_local_image(image_prompt)

        # Save turn log
        save_turn(
            session_id=req.session_id,
            player_action=req.action,
            story_text=story_text,
            audio_url=audio_url or "",
            image_url=image_url or "",
            voice_used=req.voice_name,
            dice_roll=roll_summary,
            acting_character_id=acting_char["id"],
        )

        # Rolling context summarizer (non-blocking, fires every N turns)
        try:
            maybe_summarize(req.session_id)
        except Exception as sum_err:
            print(f"⚠️ Summarizer error (non-fatal): {sum_err}")

        # Fetch updated cinematic tokens
        cinematic_tokens = get_cinematic_tokens(req.session_id)

        return {
            "story_text": story_text,
            "image_url": image_url,
            "audio_url": audio_url,
            "suggested_actions": suggested_actions,
            "party": get_party(session_id=req.session_id),
            "lorebook": get_lorebook(session_id=req.session_id),
            "history": get_history(session_id=req.session_id),
            "cinematic_tokens": cinematic_tokens,
        }

    except Exception as e:
        print(f"Turn Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
