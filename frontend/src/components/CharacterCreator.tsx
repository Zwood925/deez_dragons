"use client";

// ── Constants ──────────────────────────────────────────────────────────────────

export const CLASS_OPTIONS = [
  "Shadowblade",
  "Blood Mage",
  "Nightstalker",
  "Ironclad Paladin",
  "Weaver",
];

export const GEAR_OPTIONS = [
  { id: "steel_dagger",   label: "Steel Dagger",            category: "weapon"  },
  { id: "shortsword",     label: "Shortsword",              category: "weapon"  },
  { id: "crossbow",       label: "Crossbow & 12 Bolts",     category: "weapon"  },
  { id: "staff",          label: "Arcane Staff",            category: "weapon"  },
  { id: "health_potion",  label: "Health Potion",           category: "potion"  },
  { id: "antitoxin",      label: "Antitoxin Vial",          category: "potion"  },
  { id: "shadow_cloak",   label: "Shadow Cloak",            category: "armor"   },
  { id: "leather_armor",  label: "Leather Armor",           category: "armor"   },
  { id: "lucky_coin",     label: "Lucky Coin (trinket)",    category: "trinket" },
  { id: "signet_ring",    label: "Signet Ring (trinket)",   category: "trinket" },
];

export const STAT_KEYS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};

const HP_BY_CLASS: Record<string, number> = {
  "Shadowblade":     25,
  "Blood Mage":      18,
  "Nightstalker":    22,
  "Ironclad Paladin": 30,
  "Weaver":          20,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

export function statModifier(val: number): string {
  const mod = Math.floor((val - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function pointBuyCost(stats: Record<StatKey, number>): number {
  return STAT_KEYS.reduce((sum, k) => sum + (POINT_BUY_COSTS[stats[k]] ?? 0), 0);
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface CharacterCreatorProps {
  sessionId: number;
  apiBase: string;
  onCreated: (party: CharacterData[]) => void;
  onClose: () => void;
}

export interface CharacterData {
  id: number;
  name: string;
  character_class: string;
  hp: number;
  max_hp: number;
  stats: Record<string, number>;
  inventory: string[];
  notes: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

import { useState } from "react";

export default function CharacterCreator({
  sessionId,
  apiBase,
  onCreated,
  onClose,
}: CharacterCreatorProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [charClass, setCharClass] = useState(CLASS_OPTIONS[0]);
  const [backstory, setBackstory] = useState("");
  const [statMode, setStatMode] = useState<"standard" | "pointbuy">("standard");
  const [stats, setStats] = useState<Record<StatKey, number>>({
    STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8,
  });
  const [gear, setGear] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const pointsSpent = pointBuyCost(stats);
  const pointsLeft = POINT_BUY_BUDGET - pointsSpent;

  const setStat = (key: StatKey, val: number) => {
    if (statMode === "pointbuy") {
      const clamped = Math.max(8, Math.min(15, val));
      const newStats = { ...stats, [key]: clamped };
      if (pointBuyCost(newStats) <= POINT_BUY_BUDGET) setStats(newStats);
    } else {
      setStats((prev) => ({ ...prev, [key]: val }));
    }
  };

  const toggleGear = (id: string) => {
    setGear((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const selectedGear = GEAR_OPTIONS.filter((g) => gear.has(g.id)).map((g) => g.label);
      const hp = HP_BY_CLASS[charClass] ?? 20;

      const res = await fetch(`${apiBase}/api/party`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          name: name.trim(),
          character_class: charClass,
          hp,
          max_hp: hp,
          stats,
          inventory: selectedGear,
          notes: backstory.trim(),
        }),
      });
      const data = await res.json();
      if (data.party) {
        onCreated(data.party);
        onClose();
      }
    } catch (err) {
      console.error("Failed to create character:", err);
    }
    setSubmitting(false);
  };

  // ── Step 1: Identity ─────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-neutral-400 mb-1 uppercase tracking-wider">Character Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Seraphine Voss"
          className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-red-700"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1 uppercase tracking-wider">Class</label>
        <div className="grid grid-cols-2 gap-2">
          {CLASS_OPTIONS.map((cls) => (
            <button
              key={cls}
              onClick={() => setCharClass(cls)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors text-left ${
                charClass === cls
                  ? "bg-red-950/60 border-red-700 text-red-300"
                  : "bg-neutral-950 border-neutral-700 text-neutral-400 hover:border-neutral-500"
              }`}
            >
              {cls}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1 uppercase tracking-wider">Backstory (optional)</label>
        <textarea
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          placeholder="A few words about your character's past…"
          rows={3}
          className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-300 focus:outline-none focus:border-red-700 resize-none"
        />
      </div>
    </div>
  );

  // ── Step 2: Stats ────────────────────────────────────────────────────────────

  const renderStep2 = () => (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-2">
        {(["standard", "pointbuy"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => {
              setStatMode(mode);
              setStats({ STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 });
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              statMode === mode
                ? "bg-red-950/60 border-red-700 text-red-300"
                : "bg-neutral-950 border-neutral-700 text-neutral-400 hover:border-neutral-500"
            }`}
          >
            {mode === "standard" ? "Standard Array" : "Point Buy"}
          </button>
        ))}
      </div>

      {statMode === "pointbuy" && (
        <p className={`text-xs text-center font-mono ${pointsLeft < 0 ? "text-red-400" : "text-neutral-400"}`}>
          Points remaining: <span className="font-bold">{pointsLeft}</span> / {POINT_BUY_BUDGET}
        </p>
      )}

      {statMode === "standard" && (
        <p className="text-xs text-center text-neutral-500">
          Assign values from: {STANDARD_ARRAY.join(", ")}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {STAT_KEYS.map((key) => (
          <div key={key} className="bg-neutral-950 border border-neutral-800 rounded-lg p-2 text-center">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">{key}</div>
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={() => setStat(key, stats[key] - 1)}
                className="w-5 h-5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs flex items-center justify-center"
              >
                −
              </button>
              <span className="font-mono text-sm text-neutral-200 w-6 text-center">{stats[key]}</span>
              <button
                onClick={() => setStat(key, stats[key] + 1)}
                className="w-5 h-5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs flex items-center justify-center"
              >
                +
              </button>
            </div>
            <div className="text-[10px] text-neutral-500 mt-0.5">{statModifier(stats[key])}</div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── Step 3: Gear ─────────────────────────────────────────────────────────────

  const renderStep3 = () => {
    const categories = ["weapon", "potion", "armor", "trinket"] as const;
    return (
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">Select starting equipment (choose any combination):</p>
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-[10px] text-neutral-600 uppercase tracking-wider mb-1">{cat}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {GEAR_OPTIONS.filter((g) => g.category === cat).map((g) => (
                <button
                  key={g.id}
                  onClick={() => toggleGear(g.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors text-left ${
                    gear.has(g.id)
                      ? "bg-emerald-950/50 border-emerald-700 text-emerald-300"
                      : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  {gear.has(g.id) ? "✓ " : ""}{g.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ── Shell ────────────────────────────────────────────────────────────────────

  const stepLabels = ["Identity", "Stats", "Gear"];

  return (
    <div className="fixed inset-0 z-[150] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-800">
          <h2 className="text-base font-bold text-red-400 uppercase tracking-wider">⚔️ Create Character</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white text-sm">✕</button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-0 px-5 pt-3">
          {stepLabels.map((label, i) => {
            const s = (i + 1) as 1 | 2 | 3;
            return (
              <div key={label} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border transition-colors ${
                    step === s
                      ? "bg-red-800 border-red-600 text-white"
                      : step > s
                      ? "bg-red-950 border-red-800 text-red-400"
                      : "bg-neutral-950 border-neutral-700 text-neutral-600"
                  }`}
                >
                  {step > s ? "✓" : s}
                </div>
                <span className={`text-[10px] uppercase tracking-wider ${step === s ? "text-red-400" : "text-neutral-600"}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 pb-5 pt-3 border-t border-neutral-800 gap-3">
          <button
            onClick={() => step > 1 && setStep((s) => (s - 1) as 1 | 2 | 3)}
            disabled={step === 1}
            className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition-colors disabled:opacity-30"
          >
            ← Back
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={step === 1 && !name.trim()}
              className="flex-1 py-2 rounded-lg bg-red-900 hover:bg-red-800 text-white text-xs font-semibold transition-colors disabled:opacity-40"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting || !name.trim()}
              className="flex-1 py-2 rounded-lg bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors disabled:opacity-40"
            >
              {submitting ? "Creating…" : "✓ Create Character"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
