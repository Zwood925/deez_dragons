import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "deez_dragons.db")

# ── Default party seed ────────────────────────────────────────────────────────
DEFAULT_PARTY = [
    {
        "name": "Kaelen",
        "character_class": "Shadowblade",
        "hp": 25,
        "max_hp": 25,
        "stats": {"STR": 12, "DEX": 16, "CON": 14, "INT": 11, "WIS": 13, "CHA": 15},
        "inventory": ["Steel Dagger", "Pouch of 15 Gold", "Dark Traveling Cloak"],
        "notes": "Former mercenary with a troubled past in the borderlands.",
    }
]

# ── Seeded world lore ─────────────────────────────────────────────────────────
DEFAULT_LORE = [
    {
        "category": "NPC",
        "name": "Lady Vespera Nightshade",
        "keywords": ["vespera", "woman", "emerald", "stranger", "raven-haired", "dress"],
        "content": (
            "A high-ranking noble and spymaster from the Court of Shadows. "
            "She moves through the mortal realms hunting an ancient relic. "
            "She is dangerous, calculating, and drawn to bold audacity."
        ),
    },
    {
        "category": "Location",
        "name": "The Blackened Oak",
        "keywords": ["tavern", "blackened oak", "oak", "bar", "barkeep"],
        "content": (
            "A notorious tavern on the border of the mortal territory and the fae borders. "
            "Shady sellswords, smugglers, and outcasts gather here where no city guard dares patrol."
        ),
    },
    {
        "category": "Faction",
        "name": "The Shadow Court",
        "keywords": ["court", "fae", "shadows", "high-fae", "court of shadows"],
        "content": (
            "An elusive, aristocratic fae faction governed by ruthless politics, "
            "ancient blood pacts, and sensuous intrigue."
        ),
    },
]


# ── Schema init ───────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Sessions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            session_name      TEXT UNIQUE,
            summary           TEXT DEFAULT '',
            cinematic_tokens  INTEGER DEFAULT 3,
            created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migrate: add cinematic_tokens column if missing (safe for existing DBs)
    cursor.execute("PRAGMA table_info(sessions)")
    session_cols = {row[1] for row in cursor.fetchall()}
    if "cinematic_tokens" not in session_cols:
        cursor.execute(
            "ALTER TABLE sessions ADD COLUMN cinematic_tokens INTEGER DEFAULT 3"
        )

    # 2. Characters table — supports multiple party members per session
    #    `party_slot` is the display order; `is_active` flags the default actor.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS characters (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      INTEGER NOT NULL,
            party_slot      INTEGER DEFAULT 0,
            name            TEXT,
            character_class TEXT,
            hp              INTEGER,
            max_hp          INTEGER,
            stats_json      TEXT,
            inventory_json  TEXT,
            notes           TEXT,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    """)

    # Migrate: drop old UNIQUE constraint on session_id if it exists
    # (SQLite doesn't support DROP CONSTRAINT; we recreate via a temp table only
    #  when the old unique index is present — detected by checking sqlite_master)
    cursor.execute("""
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='characters'
          AND sql LIKE '%UNIQUE%session_id%'
    """)
    old_unique = cursor.fetchone()
    if old_unique:
        cursor.execute("ALTER TABLE characters RENAME TO characters_old")
        cursor.execute("""
            CREATE TABLE characters (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      INTEGER NOT NULL,
                party_slot      INTEGER DEFAULT 0,
                name            TEXT,
                character_class TEXT,
                hp              INTEGER,
                max_hp          INTEGER,
                stats_json      TEXT,
                inventory_json  TEXT,
                notes           TEXT,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            )
        """)
        cursor.execute("""
            INSERT INTO characters
                (id, session_id, party_slot, name, character_class, hp, max_hp,
                 stats_json, inventory_json, notes)
            SELECT id, session_id, 0, name, character_class, hp, max_hp,
                   stats_json, inventory_json, notes
            FROM characters_old
        """)
        cursor.execute("DROP TABLE characters_old")

    # 3. Turns table — now records which character acted + animation status
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS turns (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id          INTEGER,
            turn_number         INTEGER,
            acting_character_id INTEGER,
            player_action       TEXT,
            story_text          TEXT,
            audio_url           TEXT,
            image_url           TEXT,
            dice_roll           TEXT,
            voice_used          TEXT,
            video_url           TEXT DEFAULT NULL,
            animate_status      TEXT DEFAULT NULL,
            created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    """)

    # Migrate turns: add acting_character_id column if missing
    cursor.execute("PRAGMA table_info(turns)")
    turn_cols = {row[1] for row in cursor.fetchall()}
    if "acting_character_id" not in turn_cols:
        cursor.execute("ALTER TABLE turns ADD COLUMN acting_character_id INTEGER")
    if "animate_status" not in turn_cols:
        cursor.execute("ALTER TABLE turns ADD COLUMN animate_status TEXT DEFAULT NULL")
    if "video_url" not in turn_cols:
        cursor.execute("ALTER TABLE turns ADD COLUMN video_url TEXT DEFAULT NULL")

    # 4. Lorebook table (RAG memory bank)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lorebook (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  INTEGER,
            category    TEXT,
            name        TEXT,
            keywords_json TEXT,
            content     TEXT,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
    """)

    # ── Seed default session, party, and lore ─────────────────────────────────
    cursor.execute("INSERT OR IGNORE INTO sessions (id, session_name) VALUES (1, 'main')")

    cursor.execute("SELECT id FROM characters WHERE session_id = 1")
    if not cursor.fetchone():
        for slot, char in enumerate(DEFAULT_PARTY):
            cursor.execute("""
                INSERT INTO characters
                    (session_id, party_slot, name, character_class, hp, max_hp,
                     stats_json, inventory_json, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                1, slot,
                char["name"], char["character_class"],
                char["hp"], char["max_hp"],
                json.dumps(char["stats"]),
                json.dumps(char["inventory"]),
                char["notes"],
            ))

    cursor.execute("SELECT id FROM lorebook WHERE session_id = 1")
    if not cursor.fetchone():
        for entry in DEFAULT_LORE:
            cursor.execute("""
                INSERT INTO lorebook (session_id, category, name, keywords_json, content)
                VALUES (?, ?, ?, ?, ?)
            """, (1, entry["category"], entry["name"],
                  json.dumps(entry["keywords"]), entry["content"]))

    conn.commit()
    conn.close()


# ── Party helpers ─────────────────────────────────────────────────────────────
def _row_to_char(row) -> dict:
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "party_slot": row["party_slot"],
        "name": row["name"],
        "character_class": row["character_class"],
        "hp": row["hp"],
        "max_hp": row["max_hp"],
        "stats": json.loads(row["stats_json"]),
        "inventory": json.loads(row["inventory_json"]),
        "notes": row["notes"],
    }


def get_party(session_id: int = 1) -> list:
    """Return all characters in the party, ordered by party_slot."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM characters WHERE session_id = ? ORDER BY party_slot ASC",
        (session_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [_row_to_char(r) for r in rows]


def get_character(session_id: int = 1, character_id: int = None) -> dict:
    """Return a single character by id, or the first party member if id omitted."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    if character_id is not None:
        cursor.execute(
            "SELECT * FROM characters WHERE id = ? AND session_id = ?",
            (character_id, session_id),
        )
    else:
        cursor.execute(
            "SELECT * FROM characters WHERE session_id = ? ORDER BY party_slot ASC LIMIT 1",
            (session_id,),
        )
    row = cursor.fetchone()
    conn.close()
    if not row:
        return DEFAULT_PARTY[0] | {"id": -1, "session_id": session_id, "party_slot": 0}
    return _row_to_char(row)


def add_party_member(
    session_id: int,
    name: str,
    character_class: str,
    hp: int = 20,
    max_hp: int = 20,
    stats: dict = None,
    inventory: list = None,
    notes: str = "",
) -> dict:
    """Add a new character to the party with provided or default stats."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COALESCE(MAX(party_slot), -1) + 1 FROM characters WHERE session_id = ?",
        (session_id,),
    )
    next_slot = cursor.fetchone()[0]
    default_stats = stats or {"STR": 10, "DEX": 10, "CON": 10, "INT": 10, "WIS": 10, "CHA": 10}
    default_inventory = inventory or []
    cursor.execute("""
        INSERT INTO characters
            (session_id, party_slot, name, character_class, hp, max_hp,
             stats_json, inventory_json, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        session_id, next_slot, name, character_class,
        hp, max_hp,
        json.dumps(default_stats),
        json.dumps(default_inventory),
        notes,
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return get_character(session_id, new_id)


def update_character_state(
    session_id: int,
    character_id: int = None,
    hp_delta: int = 0,
    add_items: list = None,
    remove_items: list = None,
) -> dict:
    char = get_character(session_id, character_id)
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
    cursor.execute(
        "UPDATE characters SET hp = ?, inventory_json = ? WHERE id = ?",
        (new_hp, json.dumps(inv), char["id"]),
    )
    conn.commit()
    conn.close()
    return get_character(session_id, char["id"])


# ── Lorebook helpers ──────────────────────────────────────────────────────────
def get_lorebook(session_id: int = 1) -> list:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM lorebook WHERE session_id = ? ORDER BY id DESC",
        (session_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": row["id"],
            "category": row["category"],
            "name": row["name"],
            "keywords": json.loads(row["keywords_json"]),
            "content": row["content"],
        }
        for row in rows
    ]


def add_lore_entry(
    session_id: int, category: str, name: str, keywords: list, content: str
):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO lorebook (session_id, category, name, keywords_json, content)
        VALUES (?, ?, ?, ?, ?)
    """, (session_id, category, name, json.dumps(keywords), content))
    conn.commit()
    conn.close()


def match_relevant_lore(session_id: int, text_context: str) -> list:
    """Return lorebook entries whose keywords appear in the given text."""
    all_lore = get_lorebook(session_id)
    text_lower = text_context.lower()
    matched = []
    for entry in all_lore:
        for kw in entry["keywords"]:
            if kw.lower() in text_lower:
                matched.append(
                    f"[{entry['category']}: {entry['name']}] {entry['content']}"
                )
                break
    return matched


# ── Session / summary helpers ─────────────────────────────────────────────────
def get_sessions() -> list:
    """Return all sessions with id, session_name, turn_count, cinematic_tokens, created_at."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.id, s.session_name, s.created_at, s.cinematic_tokens,
               COUNT(t.id) AS turn_count
        FROM sessions s
        LEFT JOIN turns t ON t.session_id = s.id
        GROUP BY s.id
        ORDER BY s.id ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": row["id"],
            "session_name": row["session_name"],
            "turn_count": row["turn_count"],
            "cinematic_tokens": row["cinematic_tokens"] if row["cinematic_tokens"] is not None else 3,
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def create_session(
    name: str,
    template_party: list = None,
    template_lore: list = None,
    cinematic_tokens: int = 3,
) -> dict:
    """Create a new named session, optionally seeded from a campaign template."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO sessions (session_name, cinematic_tokens) VALUES (?, ?)",
        (name, cinematic_tokens),
    )
    new_id = cursor.lastrowid

    # Use template party if provided, otherwise default
    party_seed = template_party if template_party else DEFAULT_PARTY
    for slot, char in enumerate(party_seed):
        cursor.execute("""
            INSERT INTO characters
                (session_id, party_slot, name, character_class, hp, max_hp,
                 stats_json, inventory_json, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            new_id, slot,
            char["name"], char["character_class"],
            char["hp"], char["max_hp"],
            json.dumps(char.get("stats", {"STR": 10, "DEX": 10, "CON": 10, "INT": 10, "WIS": 10, "CHA": 10})),
            json.dumps(char.get("inventory", [])),
            char.get("notes", ""),
        ))

    # Use template lore if provided, otherwise default
    lore_seed = template_lore if template_lore else DEFAULT_LORE
    for entry in lore_seed:
        cursor.execute("""
            INSERT INTO lorebook (session_id, category, name, keywords_json, content)
            VALUES (?, ?, ?, ?, ?)
        """, (new_id, entry["category"], entry["name"],
              json.dumps(entry["keywords"]), entry["content"]))

    conn.commit()
    conn.close()
    return {
        "id": new_id,
        "session_name": name,
        "turn_count": 0,
        "cinematic_tokens": cinematic_tokens,
    }


def delete_session(session_id: int):
    """Delete a session and all associated turns, characters, and lorebook entries."""
    if session_id == 1:
        raise ValueError("Cannot delete the default session (id=1).")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM turns WHERE session_id = ?", (session_id,))
    cursor.execute("DELETE FROM characters WHERE session_id = ?", (session_id,))
    cursor.execute("DELETE FROM lorebook WHERE session_id = ?", (session_id,))
    cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()


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
    cursor.execute(
        "UPDATE sessions SET summary = ? WHERE id = ?", (new_summary, session_id)
    )
    conn.commit()
    conn.close()


def get_cinematic_tokens(session_id: int) -> int:
    """Return the current cinematic token count for a session."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT cinematic_tokens FROM sessions WHERE id = ?", (session_id,)
    )
    row = cursor.fetchone()
    conn.close()
    if row is None:
        return 0
    return row[0] if row[0] is not None else 3


def use_cinematic_token(session_id: int) -> int:
    """
    Atomically decrement cinematic_tokens by 1 (never below 0).
    Returns the new token count after decrement.
    Raises ValueError if no tokens remain.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE sessions SET cinematic_tokens = COALESCE(cinematic_tokens, 3) - 1 "
            "WHERE id = ? AND COALESCE(cinematic_tokens, 3) > 0",
            (session_id,),
        )
        if cursor.rowcount == 0:
            conn.rollback()
            raise ValueError("No cinematic tokens remaining for this session.")
        cursor.execute(
            "SELECT cinematic_tokens FROM sessions WHERE id = ?", (session_id,)
        )
        new_count = cursor.fetchone()[0]
        conn.commit()
        return new_count
    finally:
        conn.close()


def refund_cinematic_token(session_id: int) -> int:
    """Increment cinematic_tokens by 1 (e.g. after a failed render). Returns new count."""
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE sessions SET cinematic_tokens = COALESCE(cinematic_tokens, 3) + 1 "
            "WHERE id = ?",
            (session_id,),
        )
        cursor.execute(
            "SELECT cinematic_tokens FROM sessions WHERE id = ?", (session_id,)
        )
        row = cursor.fetchone()
        conn.commit()
        return row[0] if row and row[0] is not None else 0
    finally:
        conn.close()


def update_turn_video(turn_id: int, video_url: str, status: str):
    """Persist a completed (or failed) animation result on a turn."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE turns SET video_url = ?, animate_status = ? WHERE id = ?",
        (video_url, status, turn_id),
    )
    conn.commit()
    conn.close()


def mark_turn_animate_status(turn_id: int, status: str):
    """Set the animate_status on a turn row (e.g. 'queued', 'processing', 'done')."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE turns SET animate_status = ? WHERE id = ?",
        (status, turn_id),
    )
    conn.commit()
    conn.close()


def get_turn_by_id(turn_id: int) -> dict | None:
    """Return a single turn row by its primary key id."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM turns WHERE id = ?", (turn_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "turn_number": row["turn_number"],
        "acting_character_id": row["acting_character_id"],
        "player_action": row["player_action"],
        "story_text": row["story_text"],
        "audio_url": row["audio_url"],
        "image_url": row["image_url"],
        "dice_roll": row["dice_roll"],
        "voice_used": row["voice_used"],
        "video_url": row["video_url"],
        "animate_status": row["animate_status"],
    }


# ── Turn helpers ──────────────────────────────────────────────────────────────
def save_turn(
    session_id: int,
    player_action: str,
    story_text: str,
    audio_url: str,
    image_url: str,
    voice_used: str,
    dice_roll: str = "",
    acting_character_id: int = None,
    video_url: str = None,
    animate_status: str = None,
) -> int:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute(
        "SELECT COALESCE(MAX(turn_number), 0) FROM turns WHERE session_id = ?",
        (session_id,),
    )
    next_turn = cursor.fetchone()[0] + 1

    cursor.execute("""
        INSERT INTO turns
            (session_id, turn_number, acting_character_id, player_action,
             story_text, audio_url, image_url, voice_used, dice_roll,
             video_url, animate_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        session_id, next_turn, acting_character_id, player_action,
        story_text, audio_url, image_url, voice_used, dice_roll,
        video_url, animate_status,
    ))

    conn.commit()
    conn.close()
    return next_turn


def get_history(session_id: int = 1, limit: int = 15) -> list:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, turn_number, acting_character_id, player_action, story_text,
               audio_url, image_url, dice_roll, voice_used, video_url,
               animate_status, created_at
        FROM turns
        WHERE session_id = ?
        ORDER BY turn_number ASC
        LIMIT ?
    """, (session_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": row["id"],
            "turn_number": row["turn_number"],
            "acting_character_id": row["acting_character_id"],
            "player_action": row["player_action"],
            "story_text": row["story_text"],
            "audio_url": row["audio_url"],
            "image_url": row["image_url"],
            "dice_roll": row["dice_roll"],
            "voice_used": row["voice_used"],
            "video_url": row["video_url"],
            "animate_status": row["animate_status"],
        }
        for row in rows
    ]


def count_turns(session_id: int = 1) -> int:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM turns WHERE session_id = ?", (session_id,)
    )
    count = cursor.fetchone()[0]
    conn.close()
    return count


def get_unsummarized_turns(session_id: int = 1, after_turn: int = 0) -> list:
    """Return turns after `after_turn` for summarization."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT turn_number, player_action, story_text
        FROM turns
        WHERE session_id = ? AND turn_number > ?
        ORDER BY turn_number ASC
    """, (session_id, after_turn))
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "turn_number": row["turn_number"],
            "player_action": row["player_action"],
            "story_text": row["story_text"],
        }
        for row in rows
    ]
