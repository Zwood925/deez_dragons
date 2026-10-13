import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "deez_dragons.db")

DEFAULT_CHARACTER = {
    "name": "Kaelen",
    "character_class": "Shadowblade",
    "hp": 25,
    "max_hp": 25,
    "stats": {"STR": 12, "DEX": 16, "CON": 14, "INT": 11, "WIS": 13, "CHA": 15},
    "inventory": ["Steel Dagger", "Pouch of 15 Gold", "Dark Traveling Cloak"],
    "notes": "Former mercenary with a troubled past in the borderlands."
}

# Seeded world lore to start with
DEFAULT_LORE = [
    {
        "category": "NPC",
        "name": "Lady Vespera Nightshade",
        "keywords": ["vespera", "woman", "emerald", "stranger", "raven-haired", "dress"],
        "content": "A high-ranking noble and spymaster from the Court of Shadows. She moves through the mortal realms hunting an ancient relic. She is dangerous, calculating, and drawn to bold audacity."
    },
    {
        "category": "Location",
        "name": "The Blackened Oak",
        "keywords": ["tavern", "blackened oak", "oak", "bar", "barkeep"],
        "content": "A notorious tavern on the border of the mortal territory and the fae borders. Shady sellswords, smugglers, and outcasts gather here where no city guard dares patrol."
    },
    {
        "category": "Faction",
        "name": "The Shadow Court",
        "keywords": ["court", "fae", "shadows", "high-fae", "court of shadows"],
        "content": "An elusive, aristocratic fae faction governed by ruthless politics, ancient blood pacts, and sensuous intrigue."
    }
]

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Sessions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_name TEXT UNIQUE,
            summary TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 2. Characters table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER UNIQUE,
            name TEXT,
            character_class TEXT,
            hp INTEGER,
            max_hp INTEGER,
            stats_json TEXT,
            inventory_json TEXT,
            notes TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    """)

    # 3. Turns table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS turns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            turn_number INTEGER,
            player_action TEXT,
            story_text TEXT,
            audio_url TEXT,
            image_url TEXT,
            dice_roll TEXT,
            voice_used TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    """)

    # 4. Lorebook table (RAG memory bank)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lorebook (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            category TEXT,
            name TEXT,
            keywords_json TEXT,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    """)

    # Seed campaign, character, and initial lore
    cursor.execute("INSERT OR IGNORE INTO sessions (id, session_name) VALUES (1, 'main')")
    
    cursor.execute("SELECT id FROM characters WHERE session_id = 1")
    if not cursor.fetchone():
        cursor.execute("""
            INSERT INTO characters (session_id, name, character_class, hp, max_hp, stats_json, inventory_json, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            1,
            DEFAULT_CHARACTER["name"],
            DEFAULT_CHARACTER["character_class"],
            DEFAULT_CHARACTER["hp"],
            DEFAULT_CHARACTER["max_hp"],
            json.dumps(DEFAULT_CHARACTER["stats"]),
            json.dumps(DEFAULT_CHARACTER["inventory"]),
            DEFAULT_CHARACTER["notes"],
        ))

    cursor.execute("SELECT id FROM lorebook WHERE session_id = 1")
    if not cursor.fetchone():
        for entry in DEFAULT_LORE:
            cursor.execute("""
                INSERT INTO lorebook (session_id, category, name, keywords_json, content)
                VALUES (?, ?, ?, ?, ?)
            """, (1, entry["category"], entry["name"], json.dumps(entry["keywords"]), entry["content"]))

    conn.commit()
    conn.close()

def get_character(session_id: int = 1):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM characters WHERE session_id = ?", (session_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return DEFAULT_CHARACTER

    return {
        "name": row["name"],
        "character_class": row["character_class"],
        "hp": row["hp"],
        "max_hp": row["max_hp"],
        "stats": json.loads(row["stats_json"]),
        "inventory": json.loads(row["inventory_json"]),
        "notes": row["notes"],
    }

def update_character_state(session_id: int, hp_delta: int = 0, add_items: list = None, remove_items: list = None):
    char = get_character(session_id)
    new_hp = max(0, min(char["max_hp"], char["hp"] + hp_delta))
    
    inv = list(char["inventory"])
    if add_items:
        for item in add_items:
            if item not in inv:
                inv.append(item)
    if remove_items:
        for item in remove_items:
            if item in inv:
                inv.remove(item)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE characters 
        SET hp = ?, inventory_json = ?
        WHERE session_id = ?
    """, (new_hp, json.dumps(inv), session_id))
    conn.commit()
    conn.close()
    return get_character(session_id)

def get_lorebook(session_id: int = 1):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM lorebook WHERE session_id = ? ORDER BY id DESC", (session_id,))
    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": row["id"],
            "category": row["category"],
            "name": row["name"],
            "keywords": json.loads(row["keywords_json"]),
            "content": row["content"]
        }
        for row in rows
    ]

def add_lore_entry(session_id: int, category: str, name: str, keywords: list, content: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO lorebook (session_id, category, name, keywords_json, content)
        VALUES (?, ?, ?, ?, ?)
    """, (session_id, category, name, json.dumps(keywords), content))
    conn.commit()
    conn.close()

def match_relevant_lore(session_id: int, text_context: str) -> list:
    """Finds all lorebook entries matching words inside the user's action or immediate scene."""
    all_lore = get_lorebook(session_id)
    text_lower = text_context.lower()
    matched = []

    for entry in all_lore:
        for kw in entry["keywords"]:
            if kw.lower() in text_lower:
                matched.append(f"[{entry['category']}: {entry['name']}] {entry['content']}")
                break
    return matched

def get_session_summary(session_id: int = 1) -> str:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT summary FROM sessions WHERE id = ?", (session_id,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row and row[0] else ""

def update_session_summary(session_id: int, new_summary: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("UPDATE sessions SET summary = ? WHERE id = ?", (new_summary, session_id))
    conn.commit()
    conn.close()

def save_turn(session_id: int, player_action: str, story_text: str, audio_url: str, image_url: str, voice_used: str, dice_roll: str = ""):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("SELECT COALESCE(MAX(turn_number), 0) FROM turns WHERE session_id = ?", (session_id,))
    next_turn = cursor.fetchone()[0] + 1

    cursor.execute("""
        INSERT INTO turns (session_id, turn_number, player_action, story_text, audio_url, image_url, voice_used, dice_roll)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (session_id, next_turn, player_action, story_text, audio_url, image_url, voice_used, dice_roll))

    conn.commit()
    conn.close()
    return next_turn

def get_history(session_id: int = 1, limit: int = 15):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT turn_number, player_action, story_text, audio_url, image_url, dice_roll, voice_used, created_at
        FROM turns
        WHERE session_id = ?
        ORDER BY turn_number ASC
        LIMIT ?
    """, (session_id, limit))

    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "turn_number": row["turn_number"],
            "player_action": row["player_action"],
            "story_text": row["story_text"],
            "audio_url": row["audio_url"],
            "image_url": row["image_url"],
            "dice_roll": row["dice_roll"],
            "voice_used": row["voice_used"],
        }
        for row in rows
    ]