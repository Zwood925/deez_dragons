"use client";
import { useState, useEffect, useRef } from "react";

interface Character {
  name: string;
  character_class: string;
  hp: number;
  max_hp: number;
  stats: Record<string, number>;
  inventory: string[];
  notes: string;
}

interface LoreEntry {
  id: number;
  category: string;
  name: string;
  keywords: string[];
  content: string;
}

interface Turn {
  turn_number: number;
  player_action: string;
  story_text: string;
  audio_url: string | null;
  image_url: string | null;
  dice_roll: string;
  voice_used: string;
}

export default function Home() {
  const [action, setAction] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);
  const [lorebook, setLorebook] = useState<LoreEntry[]>([]);
  const [showCodex, setShowCodex] = useState(false);
  const [loading, setLoading] = useState(false);
  const [voice, setVoice] = useState("am_fenrir");
  
  // D20 Roller State
  const [selectedStat, setSelectedStat] = useState<string>("CHA");
  const [lastRoll, setLastRoll] = useState<{ stat: string; d20: number; modifier: number; total: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchHistory();
    fetchCharacter();
    fetchLorebook();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  const fetchCharacter = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/character");
      const data = await res.json();
      if (data.character) setCharacter(data.character);
    } catch (err) {
      console.error("Failed to load character:", err);
    }
  };

  const fetchLorebook = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/lorebook");
      const data = await res.json();
      if (data.lorebook) setLorebook(data.lorebook);
    } catch (err) {
      console.error("Failed to load lorebook:", err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/history");
      const data = await res.json();
      if (data.turns) setHistory(data.turns);
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  };

  const rollD20 = () => {
    if (!character) return;
    const score = character.stats[selectedStat] || 10;
    const modifier = Math.floor((score - 10) / 2);
    const d20 = Math.floor(Math.random() * 20) + 1;
    const total = d20 + modifier;
    const rollData = { stat: selectedStat, d20, modifier, total };
    setLastRoll(rollData);
    return rollData;
  };

  const submitTurn = async (withRoll = false) => {
    if (!action.trim() || loading) return;
    const userAction = action;
    setAction("");
    setLoading(true);

    let dicePayload = null;
    if (withRoll) {
      dicePayload = rollD20();
    } else {
      setLastRoll(null);
    }

    try {
      const res = await fetch("http://localhost:8000/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          action: userAction, 
          session_id: 1,
          voice_name: voice,
          dice_roll: dicePayload
        }),
      });
      const data = await res.json();
      if (data.history) setHistory(data.history);
      if (data.character) setCharacter(data.character);
      if (data.lorebook) setLorebook(data.lorebook);
    } catch (error) {
      console.error("Error submitting turn:", error);
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col items-center justify-center p-3 font-sans relative">
      <div className="max-w-4xl w-full bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-2xl flex flex-col h-[94vh]">
        
        {/* Top Header & Character HUD */}
        <div className="border-b border-neutral-800 pb-3 mb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-red-800 tracking-wider uppercase">
                Deez Dragons
              </h1>
              <p className="text-xs text-neutral-500">Dark Romantic RPG</p>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="bg-neutral-950 text-neutral-300 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-red-800 cursor-pointer"
              >
                <option value="am_fenrir">Fenrir (Deep / Brooding)</option>
                <option value="am_onyx">Onyx (Velvety)</option>
                <option value="bm_fable">Fable (High-Fae)</option>
                <option value="af_sarah">Sarah (Seductive)</option>
              </select>

              {/* Toggle Lorebook Drawer */}
              <button
                onClick={() => setShowCodex(!showCodex)}
                className="bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-neutral-700 rounded-lg px-3 py-1 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                📖 Codex ({lorebook.length})
              </button>
            </div>
          </div>

          {/* Character HUD Banner */}
          {character && (
            <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <div>
                  <span className="font-bold text-neutral-200 text-sm">{character.name}</span>
                  <span className="text-neutral-500 ml-1.5">({character.character_class})</span>
                </div>

                {/* HP Bar */}
                <div className="flex items-center gap-2">
                  <span className="text-neutral-400 font-semibold">HP:</span>
                  <div className="w-24 bg-neutral-800 h-2.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-red-700 h-full transition-all duration-500"
                      style={{ width: `${(character.hp / character.max_hp) * 100}%` }}
                    />
                  </div>
                  <span className="text-neutral-300">{character.hp}/{character.max_hp}</span>
                </div>
              </div>

              {/* Stat Badges */}
              <div className="flex gap-2">
                {Object.entries(character.stats).map(([st, val]) => (
                  <span key={st} className="bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded text-neutral-400 font-mono">
                    <strong className="text-neutral-200">{st}:</strong> {val}
                  </span>
                ))}
              </div>

              {/* Inventory Pills */}
              <div className="w-full flex items-center gap-1.5 pt-1 overflow-x-auto text-neutral-400">
                <span className="text-neutral-500">Loot:</span>
                {character.inventory.map((item, idx) => (
                  <span key={idx} className="bg-red-950/30 border border-red-900/40 text-red-300 px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap">
                    🗡️ {item}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Scrollable Story Chat Log */}
        <div className="flex-1 overflow-y-auto space-y-5 pr-2 mb-3">
          {history.length === 0 ? (
            <div className="text-center text-neutral-500 italic mt-20">
              The tavern is quiet... make your move or roll a check below.
            </div>
          ) : (
            history.map((turn, idx) => (
              <div key={idx} className="space-y-3">
                {/* Player Action + Roll Badge */}
                <div className="flex flex-col items-end gap-1">
                  <div className="bg-red-950/40 border border-red-900/60 text-red-200 px-4 py-2 rounded-lg max-w-[80%] text-sm shadow">
                    <span className="font-semibold text-red-400">You: </span>
                    {turn.player_action}
                  </div>
                  {turn.dice_roll && (
                    <span className="text-[11px] font-mono bg-neutral-950 text-amber-400 border border-neutral-800 px-2 py-0.5 rounded">
                      🎲 {turn.dice_roll}
                    </span>
                  )}
                </div>

                {/* DM Response Card */}
                <div className="bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden shadow-xl">
                  {turn.image_url && (
                    <div className="w-full max-h-[400px] overflow-hidden border-b border-neutral-800">
                      <img 
                        src={turn.image_url} 
                        alt="Scene visualization" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div className="p-4 space-y-3">
                    <p className="text-sm leading-relaxed text-neutral-300 italic whitespace-pre-line">
                      {turn.story_text}
                    </p>
                    
                    {turn.audio_url && (
                      <div className="pt-1">
                        <audio controls src={turn.audio_url} className="w-full h-7" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="text-neutral-400 italic text-xs animate-pulse text-center py-3 bg-neutral-950/50 rounded border border-neutral-800/50">
              Consulting the ancient codex, rolling the dice, and painting the scene...
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        {/* Action & Dice Input Bar */}
        <div className="pt-2 border-t border-neutral-800 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400 font-semibold">Test Stat:</span>
            <select
              value={selectedStat}
              onChange={(e) => setSelectedStat(e.target.value)}
              className="bg-neutral-950 text-amber-300 border border-neutral-800 rounded px-2 py-1 focus:outline-none focus:border-red-800 cursor-pointer"
            >
              <option value="CHA">Charisma (Charm / Flirt / Deceive)</option>
              <option value="STR">Strength (Athletics / Force)</option>
              <option value="DEX">Dexterity (Stealth / Sleight / Agility)</option>
              <option value="WIS">Wisdom (Perception / Insight)</option>
              <option value="INT">Intelligence (Lore / Investigation)</option>
              <option value="CON">Constitution (Endurance / Resisting Poison)</option>
            </select>

            {lastRoll && (
              <span className="text-amber-400 font-mono ml-auto">
                Last Roll: {lastRoll.d20} + {lastRoll.modifier} = <strong>{lastRoll.total}</strong>
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitTurn(false)}
              placeholder="What is your next move?"
              disabled={loading}
              className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-red-800 transition-colors disabled:opacity-50"
            />
            
            <button 
              onClick={() => submitTurn(false)}
              disabled={loading || !action.trim()}
              className="bg-neutral-800 hover:bg-neutral-700 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              Act
            </button>

            <button 
              onClick={() => submitTurn(true)}
              disabled={loading || !action.trim()}
              className="bg-red-900 hover:bg-red-800 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              🎲 Roll & Act
            </button>
          </div>
        </div>

      </div>

      {/* World Codex Side Drawer Modal */}
      {showCodex && (
        <div className="absolute inset-y-0 right-0 w-80 bg-neutral-900 border-l border-neutral-800 p-5 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-4">
            <h2 className="text-base font-bold text-amber-400 uppercase tracking-wider">
              📖 World Codex
            </h2>
            <button 
              onClick={() => setShowCodex(false)}
              className="text-neutral-400 hover:text-white text-sm"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
            {lorebook.map((entry) => (
              <div key={entry.id} className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-200">{entry.name}</span>
                  <span className="text-[10px] text-amber-500 bg-amber-950/40 border border-amber-900/50 px-1.5 py-0.5 rounded">
                    {entry.category}
                  </span>
                </div>
                <p className="text-neutral-400 leading-relaxed italic">
                  {entry.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}