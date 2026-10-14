"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import ProloguePlayer from "@/components/ProloguePlayer";
import type { CutsceneSlide } from "@/components/ProloguePlayer";
import CharacterCreator from "@/components/CharacterCreator";
import type { CharacterData } from "@/components/CharacterCreator";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LoreEntry {
  id: number;
  category: string;
  name: string;
  keywords: string[];
  content: string;
}

interface Turn {
  id: number;
  turn_number: number;
  player_action: string;
  story_text: string;
  audio_url: string | null;
  image_url: string | null;
  dice_roll: string;
  voice_used: string;
  acting_character_id: number | null;
  animate_status: string | null;
}

interface Session {
  id: number;
  session_name: string;
  turn_count: number;
  cinematic_tokens: number;
  created_at: string;
}

interface CampaignTemplate {
  id: string;
  title: string;
  tagline: string;
  tone: string;
  default_voice: string;
  initial_prose: string;
  starting_lore: Array<{ name: string; category: string; keywords: string[]; content: string }>;
  default_character: {
    name: string;
    character_class: string;
    hp: number;
    max_hp: number;
    stats: Record<string, number>;
    inventory: string[];
    notes: string;
  };
  cutscene_slides: CutsceneSlide[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type Character = CharacterData;

function hpPercent(char: Character) {
  return Math.max(0, Math.min(100, (char.hp / char.max_hp) * 100));
}

function hpColor(char: Character) {
  const pct = hpPercent(char);
  if (pct > 60) return "bg-green-700";
  if (pct > 30) return "bg-yellow-600";
  return "bg-red-700";
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function Home() {
  // Core state
  const [action, setAction] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [party, setParty] = useState<Character[]>([]);
  const [activeCharId, setActiveCharId] = useState<number | null>(null);
  const [lorebook, setLorebook] = useState<LoreEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Session / campaign state
  const [currentSessionId, setCurrentSessionId] = useState<number>(1);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showCampaigns, setShowCampaigns] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [campaignCreating, setCampaignCreating] = useState(false);
  const [cinematicTokens, setCinematicTokens] = useState<number>(3);

  // Campaign templates
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Prologue cutscene state
  const [prologueActive, setPrologueActive] = useState(false);
  const [prologueSlides, setPrologueSlides] = useState<CutsceneSlide[]>([]);
  const [prologueSlideIndex, setPrologueSlideIndex] = useState(0);
  const [prologueKey, setPrologueKey] = useState(0);

  // Drawer state
  const [showCodex, setShowCodex] = useState(false);
  const [showPartyManager, setShowPartyManager] = useState(false);
  const [showCharWizard, setShowCharWizard] = useState(false);

  // Voice settings
  const [voice, setVoice] = useState("am_fenrir");
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [autoPlayAudio, setAutoPlayAudio] = useState(false);

  // Fast-pace toggles
  const [genImage, setGenImage] = useState(true);
  const [genAudio, setGenAudio] = useState(true);

  // Suggested actions
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // D20 Roller
  const [selectedStat, setSelectedStat] = useState<string>("CHA");
  const [lastRoll, setLastRoll] = useState<{ stat: string; d20: number; modifier: number; total: number } | null>(null);

  // Animate scene state
  const [animatingTurns, setAnimatingTurns] = useState<Record<number, string>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Data Fetchers ────────────────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/sessions`);
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  }, []);

  const fetchParty = useCallback(async (sid: number) => {
    try {
      const res = await fetch(`${API}/api/party?session_id=${sid}`);
      const data = await res.json();
      if (data.party) setParty(data.party);
    } catch (err) {
      console.error("Failed to load party:", err);
    }
  }, []);

  const fetchLorebook = useCallback(async (sid: number) => {
    try {
      const res = await fetch(`${API}/api/lorebook?session_id=${sid}`);
      const data = await res.json();
      if (data.lorebook) setLorebook(data.lorebook);
    } catch (err) {
      console.error("Failed to load lorebook:", err);
    }
  }, []);

  const fetchHistory = useCallback(async (sid: number) => {
    try {
      const res = await fetch(`${API}/api/history?session_id=${sid}`);
      const data = await res.json();
      if (data.turns) setHistory(data.turns);
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/campaign-templates`);
      const data = await res.json();
      if (data.templates) setTemplates(data.templates);
    } catch (err) {
      console.error("Failed to load templates:", err);
    }
  }, []);

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchSessions();
    fetchHistory(currentSessionId);
    fetchParty(currentSessionId);
    fetchLorebook(currentSessionId);
  }, [fetchSessions, fetchHistory, fetchParty, fetchLorebook, currentSessionId]);

  useEffect(() => {
    const s = sessions.find((x) => x.id === currentSessionId);
    if (s) setCinematicTokens(s.cinematic_tokens ?? 3);
  }, [sessions, currentSessionId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  useEffect(() => {
    if (party.length > 0) {
      setActiveCharId((prev) => (party.find((c) => c.id === prev) ? prev : party[0].id));
    } else {
      setActiveCharId(null);
    }
  }, [party]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxUrl(null);
        setPrologueActive(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (showCampaigns && templates.length === 0) fetchTemplates();
  }, [showCampaigns, templates.length, fetchTemplates]);

  // ── Session Helpers ──────────────────────────────────────────────────────────

  const switchSession = (sid: number) => {
    setCurrentSessionId(sid);
    setHistory([]);
    setParty([]);
    setLorebook([]);
    setSuggestedActions([]);
    setLastRoll(null);
    setShowCampaigns(false);
    setAnimatingTurns({});
  };

  const createCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setCampaignCreating(true);
    try {
      const body: Record<string, string> = { name: newCampaignName.trim() };
      if (selectedTemplateId) body.template_id = selectedTemplateId;

      const res = await fetch(`${API}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
      if (data.session) {
        switchSession(data.session.id);
        if (data.template?.default_voice) setVoice(data.template.default_voice);
        if (data.cutscene_slides?.length > 0) {
          setPrologueSlides(data.cutscene_slides);
          setPrologueSlideIndex(0);
          setPrologueKey((k) => k + 1);
          setPrologueActive(true);
        }
      }
      setNewCampaignName("");
      setSelectedTemplateId("");
    } catch (err) {
      console.error("Failed to create campaign:", err);
    }
    setCampaignCreating(false);
  };

  const deleteCampaign = async (sid: number) => {
    if (!confirm("Delete this campaign and all its turns? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API}/api/sessions/${sid}`, { method: "DELETE" });
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
      if (sid === currentSessionId) switchSession(sessions[0]?.id ?? 1);
    } catch (err) {
      console.error("Failed to delete campaign:", err);
    }
  };

  // ── Prologue Helpers ─────────────────────────────────────────────────────────

  const prologueNext = () => {
    if (prologueSlideIndex < prologueSlides.length - 1) {
      setPrologueSlideIndex((i) => i + 1);
      setPrologueKey((k) => k + 1);
    } else {
      setPrologueActive(false);
    }
  };

  const prologuePrev = () => {
    if (prologueSlideIndex > 0) {
      setPrologueSlideIndex((i) => i - 1);
      setPrologueKey((k) => k + 1);
    }
  };

  // ── D20 Roller ───────────────────────────────────────────────────────────────

  const activeChar = party.find((c) => c.id === activeCharId) ?? null;

  const rollD20 = () => {
    if (!activeChar) return null;
    const score = activeChar.stats[selectedStat] ?? 10;
    const modifier = Math.floor((score - 10) / 2);
    const d20 = Math.floor(Math.random() * 20) + 1;
    const total = d20 + modifier;
    const rollData = { stat: selectedStat, d20, modifier, total };
    setLastRoll(rollData);
    return rollData;
  };

  // ── Turn Submission ──────────────────────────────────────────────────────────

  const submitTurn = async (overrideAction?: string, withRoll = false) => {
    const userAction = (overrideAction ?? action).trim();
    if (!userAction || loading || !activeCharId) return;
    setAction("");
    setSuggestedActions([]);
    setLoading(true);

    let dicePayload = null;
    if (withRoll) {
      dicePayload = rollD20();
    } else {
      setLastRoll(null);
    }

    try {
      const res = await fetch(`${API}/api/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: userAction,
          session_id: currentSessionId,
          acting_character_id: activeCharId,
          voice_name: voice,
          dice_roll: dicePayload,
          generate_image: genImage,
          generate_audio: genAudio,
        }),
      });
      const data = await res.json();
      if (data.history) setHistory(data.history);
      if (data.party) setParty(data.party);
      if (data.lorebook) setLorebook(data.lorebook);
      if (data.suggested_actions) setSuggestedActions(data.suggested_actions);
      if (typeof data.cinematic_tokens === "number") setCinematicTokens(data.cinematic_tokens);

      if (autoPlayAudio && data.audio_url) {
        try {
          audioRef.current?.pause();
          const audio = new Audio(data.audio_url);
          audioRef.current = audio;
          await audio.play();
        } catch (playErr) {
          console.warn("Auto-play blocked:", playErr);
        }
      }

      fetchSessions();
    } catch (error) {
      console.error("Error submitting turn:", error);
    }
    setLoading(false);
  };

  // ── Animate Scene ────────────────────────────────────────────────────────────

  const animateScene = async (turnId: number) => {
    if (cinematicTokens <= 0) return;
    const cur = animatingTurns[turnId];
    if (cur === "queued" || cur === "processing" || cur === "done") return;

    setAnimatingTurns((prev) => ({ ...prev, [turnId]: "queued" }));
    try {
      const res = await fetch(`${API}/api/turn/animate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: currentSessionId, turn_id: turnId }),
      });
      const data = await res.json();
      if (typeof data.tokens_remaining === "number") {
        setCinematicTokens(data.tokens_remaining);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId ? { ...s, cinematic_tokens: data.tokens_remaining } : s
          )
        );
      }
      setAnimatingTurns((prev) => ({ ...prev, [turnId]: data.status ?? "queued" }));
    } catch (err) {
      console.error("Failed to animate scene:", err);
      setAnimatingTurns((prev) => {
        const next = { ...prev };
        delete next[turnId];
        return next;
      });
    }
  };

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col items-center justify-center p-3 font-sans relative">

      {/* ── Prologue Overlay ── */}
      {prologueActive && (
        <ProloguePlayer
          slides={prologueSlides}
          slideIndex={prologueSlideIndex}
          slideKey={prologueKey}
          onNext={prologueNext}
          onPrev={prologuePrev}
          onSkip={() => setPrologueActive(false)}
        />
      )}

      {/* ── Character Creator Modal ── */}
      {showCharWizard && (
        <CharacterCreator
          sessionId={currentSessionId}
          apiBase={API}
          onCreated={(newParty) => setParty(newParty)}
          onClose={() => setShowCharWizard(false)}
        />
      )}

      {/* ── Lightbox Modal ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Full scene render"
              className="w-full rounded-xl shadow-2xl border border-neutral-700"
            />
            <div className="absolute top-3 right-3 flex gap-2">
              <a
                href={lightboxUrl}
                download
                className="bg-black/70 hover:bg-black text-white text-xs px-3 py-1.5 rounded-lg border border-neutral-600 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                ⬇ Download Scene
              </a>
              <button
                onClick={() => setLightboxUrl(null)}
                className="bg-black/70 hover:bg-black text-white text-xs px-3 py-1.5 rounded-lg border border-neutral-600 transition-colors"
              >
                ✕ Close
              </button>
            </div>
            <p className="text-center text-neutral-600 text-xs mt-2">Press Esc or click outside to dismiss</p>
          </div>
        </div>
      )}

      <div className="max-w-4xl w-full bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-2xl flex flex-col h-[94vh] relative">

        {/* ── Party Manager Side Drawer ── */}
        {showPartyManager && (
          <div className="absolute inset-y-0 left-0 w-80 bg-neutral-900 border-r border-neutral-800 p-5 shadow-2xl z-50 flex flex-col rounded-l-xl">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-4">
              <h2 className="text-base font-bold text-emerald-400 uppercase tracking-wider">⚔️ Party Manager</h2>
              <button onClick={() => setShowPartyManager(false)} className="text-neutral-400 hover:text-white text-sm">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs mb-4">
              {party.length === 0 && (
                <p className="text-neutral-600 italic text-center py-4">No party members yet.</p>
              )}
              {party.map((char) => (
                <div
                  key={char.id}
                  onClick={() => { setActiveCharId(char.id); setShowPartyManager(false); }}
                  className={`bg-neutral-950 border rounded-lg p-3 space-y-2 cursor-pointer transition-colors ${
                    activeCharId === char.id ? "border-red-700" : "border-neutral-800 hover:border-neutral-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-neutral-200 text-sm">{char.name}</span>
                    <span className="text-[10px] text-neutral-500 bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 rounded">
                      {char.character_class}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                      <div className={`${hpColor(char)} h-full transition-all`} style={{ width: `${hpPercent(char)}%` }} />
                    </div>
                    <span className="font-mono text-neutral-400">{char.hp}/{char.max_hp} HP</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {Object.entries(char.stats).map(([st, val]) => (
                      <span key={st} className="bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 rounded font-mono text-neutral-400">
                        {st}: {val}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {char.inventory.map((item, i) => (
                      <span key={i} className="bg-red-950/30 border border-red-900/40 text-red-300 px-1.5 py-0 rounded-full text-[10px]">
                        {item}
                      </span>
                    ))}
                  </div>
                  {char.notes && <p className="text-neutral-500 italic">{char.notes}</p>}
                </div>
              ))}
            </div>

            <div className="border-t border-neutral-800 pt-3">
              <button
                onClick={() => { setShowPartyManager(false); setShowCharWizard(true); }}
                className="w-full bg-emerald-900 hover:bg-emerald-800 text-white font-semibold py-2 rounded-lg text-xs transition-colors"
              >
                + Create New Character
              </button>
            </div>
          </div>
        )}

        {/* ── World Codex Side Drawer ── */}
        {showCodex && (
          <div className="absolute inset-y-0 right-0 w-80 bg-neutral-900 border-l border-neutral-800 p-5 shadow-2xl z-50 flex flex-col rounded-r-xl">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-4">
              <h2 className="text-base font-bold text-amber-400 uppercase tracking-wider">📖 World Codex</h2>
              <button onClick={() => setShowCodex(false)} className="text-neutral-400 hover:text-white text-sm">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
              {lorebook.length === 0 && (
                <p className="text-neutral-600 italic text-center py-4">No lore discovered yet.</p>
              )}
              {lorebook.map((entry) => (
                <div key={entry.id} className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-200">{entry.name}</span>
                    <span className="text-[10px] text-amber-500 bg-amber-950/40 border border-amber-900/50 px-1.5 py-0.5 rounded">
                      {entry.category}
                    </span>
                  </div>
                  <p className="text-neutral-400 leading-relaxed italic">{entry.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Campaign Manager Modal ── */}
        {showCampaigns && (
          <div
            className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
            onClick={() => setShowCampaigns(false)}
          >
            <div
              className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 max-w-lg w-full space-y-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <h2 className="text-sm font-bold text-rose-400 uppercase tracking-wider">🗺️ Campaign Manager</h2>
                <button onClick={() => setShowCampaigns(false)} className="text-neutral-400 hover:text-white text-sm">✕</button>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 text-xs">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between p-2 rounded border transition-colors ${
                      s.id === currentSessionId
                        ? "bg-red-950/30 border-red-800 text-red-300"
                        : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700"
                    }`}
                  >
                    <button onClick={() => switchSession(s.id)} className="flex-1 text-left flex items-center justify-between">
                      <span className="font-semibold text-neutral-200">{s.session_name}</span>
                      <span className="text-[10px] text-neutral-500 font-mono">
                        {s.turn_count} turns • 🎬 {s.cinematic_tokens ?? 3} tokens
                      </span>
                    </button>
                    {s.id !== 1 && (
                      <button
                        onClick={() => deleteCampaign(s.id)}
                        className="text-neutral-600 hover:text-red-400 text-xs ml-3 transition-colors"
                        title="Delete campaign"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="border-t border-neutral-800 pt-3 space-y-2">
                <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">+ New Campaign</h3>
                <input
                  type="text"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  placeholder="Campaign title..."
                  className="w-full bg-neutral-950 border border-neutral-700 rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-red-800"
                />

                {templates.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[11px] text-neutral-400 block">Choose Story Template (Optional):</label>
                    <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto">
                      {templates.map((tpl) => (
                        <div
                          key={tpl.id}
                          onClick={() => setSelectedTemplateId(selectedTemplateId === tpl.id ? "" : tpl.id)}
                          className={`p-2 rounded border cursor-pointer text-xs transition-all ${
                            selectedTemplateId === tpl.id
                              ? "border-red-700 bg-red-950/30 text-neutral-200"
                              : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700"
                          }`}
                        >
                          <div className="font-semibold text-neutral-200">{tpl.title}</div>
                          <div className="text-[10px] text-neutral-500 italic">{tpl.tagline}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={createCampaign}
                  disabled={!newCampaignName.trim() || campaignCreating}
                  className="w-full bg-red-900 hover:bg-red-800 text-white font-semibold py-2 rounded text-xs transition-colors disabled:opacity-50"
                >
                  {campaignCreating ? "Creating Campaign..." : "Start Campaign"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Top Header ── */}
        <div className="border-b border-neutral-800 pb-3 mb-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-xl font-bold text-red-800 tracking-wider uppercase">Deez Dragons</h1>
              <p className="text-xs text-neutral-500">
                Dark Romantic RPG
                {currentSession && (
                  <span className="ml-2 text-neutral-600">
                    — <span className="text-neutral-400">{currentSession.session_name}</span>
                    <span className="ml-1 text-neutral-600">({currentSession.turn_count} turns)</span>
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Cinematic Token Badge */}
              <div
                title={`${cinematicTokens}/3 Cinematic Tokens remaining. Use 🎬 Animate Scene on any turn card.`}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors select-none ${
                  cinematicTokens > 0
                    ? "bg-purple-950/50 border-purple-700 text-purple-300"
                    : "bg-neutral-950 border-neutral-700 text-neutral-500"
                }`}
              >
                🎬 Tokens: {cinematicTokens}/3
              </div>

              {/* Art Toggle */}
              <button
                onClick={() => setGenImage((v) => !v)}
                title="Toggle scene art generation"
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  genImage
                    ? "bg-violet-950/50 border-violet-700 text-violet-300"
                    : "bg-neutral-950 border-neutral-700 text-neutral-500 line-through"
                }`}
              >
                🖼️ Art
              </button>

              {/* Voice Toggle */}
              <button
                onClick={() => setGenAudio((v) => !v)}
                title="Toggle narrator voice generation"
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  genAudio
                    ? "bg-blue-950/50 border-blue-700 text-blue-300"
                    : "bg-neutral-950 border-neutral-700 text-neutral-500 line-through"
                }`}
              >
                🎙️ Voice
              </button>

              {/* Voice Selector Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowVoiceMenu((v) => !v)}
                  className="bg-neutral-950 text-neutral-300 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-red-800 cursor-pointer flex items-center gap-1"
                >
                  🔊 {voice.replace(/^[ab][mf]_/, "")}
                  <span className="text-neutral-600">▾</span>
                </button>
                {showVoiceMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 min-w-[200px] py-1">
                    {[
                      { value: "am_fenrir", label: "Fenrir (Deep / Brooding)" },
                      { value: "am_onyx",   label: "Onyx (Velvety)" },
                      { value: "bm_fable",  label: "Fable (High-Fae)" },
                      { value: "af_sarah",  label: "Sarah (Seductive)" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { setVoice(opt.value); setShowVoiceMenu(false); }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-800 transition-colors ${
                          voice === opt.value ? "text-red-400 font-semibold" : "text-neutral-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                    <div className="border-t border-neutral-800 mt-1 pt-1 px-3 pb-1.5">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-400 hover:text-neutral-200 transition-colors">
                        <input
                          type="checkbox"
                          checked={autoPlayAudio}
                          onChange={(e) => setAutoPlayAudio(e.target.checked)}
                          className="accent-red-700 w-3 h-3"
                        />
                        Auto-Play Narrator
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Campaigns Button */}
              <button
                onClick={() => { setShowCampaigns(!showCampaigns); setShowPartyManager(false); setShowCodex(false); }}
                className="bg-neutral-800 hover:bg-neutral-700 text-rose-300 border border-neutral-700 rounded-lg px-3 py-1 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                🗺️ Campaigns
              </button>

              {/* Party Button */}
              <button
                onClick={() => { setShowPartyManager(!showPartyManager); setShowCodex(false); setShowCampaigns(false); }}
                className="bg-neutral-800 hover:bg-neutral-700 text-emerald-300 border border-neutral-700 rounded-lg px-3 py-1 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                ⚔️ Party ({party.length})
              </button>

              {/* Codex Button */}
              <button
                onClick={() => { setShowCodex(!showCodex); setShowPartyManager(false); setShowCampaigns(false); }}
                className="bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-neutral-700 rounded-lg px-3 py-1 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                📖 Codex ({lorebook.length})
              </button>
            </div>
          </div>

          {/* Party HUD Banner */}
          {activeChar && (
            <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <div>
                  <span className="font-bold text-neutral-200 text-sm">{activeChar.name}</span>
                  <span className="text-neutral-500 ml-1.5">({activeChar.character_class})</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-neutral-400 font-semibold">HP:</span>
                  <div className="w-24 bg-neutral-800 h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`${hpColor(activeChar)} h-full transition-all duration-500`}
                      style={{ width: `${hpPercent(activeChar)}%` }}
                    />
                  </div>
                  <span className="text-neutral-300">{activeChar.hp}/{activeChar.max_hp}</span>
                </div>
              </div>

              {/* Stat Badges */}
              <div className="flex gap-2">
                {Object.entries(activeChar.stats).map(([st, val]) => (
                  <span
                    key={st}
                    className={`border px-2 py-0.5 rounded font-mono ${
                      selectedStat === st
                        ? "bg-amber-950/40 border-amber-600 text-amber-300"
                        : "bg-neutral-900 border-neutral-800 text-neutral-400"
                    }`}
                  >
                    <strong className="text-neutral-200">{st}:</strong> {val}
                  </span>
                ))}
              </div>

              {/* Inventory Pills */}
              <div className="w-full flex items-center gap-1.5 pt-1 overflow-x-auto text-neutral-400">
                <span className="text-neutral-500">Loot:</span>
                {activeChar.inventory.map((item, idx) => (
                  <span key={idx} className="bg-red-950/30 border border-red-900/40 text-red-300 px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap">
                    🗡️ {item}
                  </span>
                ))}
              </div>

              {party.length > 1 && (
                <div className="w-full flex items-center gap-1.5 pt-1 border-t border-neutral-800 text-[11px]">
                  <span className="text-neutral-500">Party Turn:</span>
                  {party.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setActiveCharId(p.id)}
                      className={`px-2 py-0.5 rounded font-semibold border transition-colors ${
                        activeCharId === p.id
                          ? "bg-emerald-950/50 border-emerald-600 text-emerald-300"
                          : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700"
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Story Feed ── */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-3">
          {history.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-12">
              <p className="text-neutral-600 text-sm italic">The story has not yet begun...</p>
              {party.length === 0 && (
                <button
                  onClick={() => setShowCharWizard(true)}
                  className="bg-red-900 hover:bg-red-800 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
                >
                  ⚔ Create Your Character
                </button>
              )}
            </div>
          )}

          {history.map((turn, idx) => {
            const isLastTurn = idx === history.length - 1;
            const actor = party.find((p) => p.id === turn.acting_character_id);
            const animStatus = animatingTurns[turn.id] || turn.animate_status;

            return (
              <div key={turn.id ?? idx} className="space-y-3">
                {/* Player Action */}
                <div className="flex flex-col items-end gap-1">
                  <div className="bg-red-950/40 border border-red-900/60 text-red-200 px-4 py-2 rounded-lg max-w-[80%] text-sm shadow">
                    <span className="font-semibold text-red-400">
                      [{actor?.name ?? "Player"}]:{" "}
                    </span>
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
                    <div className="relative group w-full max-h-[400px] overflow-hidden border-b border-neutral-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={turn.image_url}
                        alt="Scene visualization"
                        className="w-full h-full object-cover cursor-zoom-in transition-transform duration-300 group-hover:scale-[1.02]"
                        onClick={() => setLightboxUrl(turn.image_url)}
                      />

                      <div className="absolute top-2 right-2 flex gap-2">
                        <button
                          onClick={() => setLightboxUrl(turn.image_url)}
                          className="bg-black/60 hover:bg-black text-white text-[10px] px-2.5 py-1 rounded border border-neutral-700 backdrop-blur-sm transition-colors"
                        >
                          🔍 Zoom
                        </button>

                        <button
                          onClick={() => animateScene(turn.id)}
                          disabled={cinematicTokens <= 0 || animStatus === "queued" || animStatus === "processing" || animStatus === "done"}
                          className={`text-[10px] px-2.5 py-1 rounded border backdrop-blur-sm transition-colors flex items-center gap-1 ${
                            animStatus === "done"
                              ? "bg-emerald-950/70 border-emerald-700 text-emerald-300 cursor-default"
                              : animStatus === "queued" || animStatus === "processing"
                              ? "bg-purple-950/70 border-purple-700 text-purple-300 animate-pulse cursor-wait"
                              : cinematicTokens > 0
                              ? "bg-purple-950/70 hover:bg-purple-900 border-purple-600 text-purple-200"
                              : "bg-neutral-900/70 border-neutral-700 text-neutral-500 cursor-not-allowed"
                          }`}
                        >
                          {animStatus === "done"
                            ? "✓ Animated"
                            : animStatus === "processing"
                            ? "🎬 Rendering..."
                            : animStatus === "queued"
                            ? "⏳ Queued"
                            : `🎬 Animate Scene (${cinematicTokens} Left)`}
                        </button>
                      </div>
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

                {/* Suggested Action Chips */}
                {isLastTurn && suggestedActions.length > 0 && !loading && (
                  <div className="pt-1 space-y-1.5">
                    <span className="text-[10px] text-neutral-500 font-semibold tracking-wider uppercase">
                      Suggested Actions:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {suggestedActions.map((sug, sIdx) => (
                        <button
                          key={sIdx}
                          onClick={() => submitTurn(sug, false)}
                          className="bg-neutral-900 hover:bg-red-950/40 border border-neutral-700 hover:border-red-700 text-neutral-300 hover:text-red-200 text-xs px-3 py-1.5 rounded-lg text-left transition-colors"
                        >
                          {sug}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="text-neutral-400 italic text-xs animate-pulse text-center py-3 bg-neutral-950/50 rounded border border-neutral-800/50">
              Consulting the ancient codex, rolling the dice, and weaving the tale...
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        {/* ── Action & Dice Input Bar ── */}
        <div className="pt-2 border-t border-neutral-800 space-y-2">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-neutral-400 font-semibold">Test Stat:</span>
            <select
              value={selectedStat}
              onChange={(e) => setSelectedStat(e.target.value)}
              className="bg-neutral-950 text-amber-300 border border-neutral-800 rounded px-2 py-1 focus:outline-none focus:border-red-800 cursor-pointer text-xs"
            >
              <option value="CHA">Charisma (Charm / Flirt / Deceive)</option>
              <option value="STR">Strength (Athletics / Force)</option>
              <option value="DEX">Dexterity (Stealth / Sleight / Agility)</option>
              <option value="WIS">Wisdom (Perception / Insight)</option>
              <option value="INT">Intelligence (Lore / Investigation)</option>
              <option value="CON">Constitution (Endurance / Poison)</option>
            </select>

            {lastRoll && (
              <span className="text-amber-400 font-mono ml-auto text-xs">
                Last Roll: {lastRoll.d20} + {lastRoll.modifier} = <strong>{lastRoll.total}</strong>
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitTurn(undefined, false)}
              placeholder={activeChar ? `What does ${activeChar.name} do?` : "Create or select a character to act..."}
              disabled={loading || !activeCharId}
              className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-red-800 transition-colors disabled:opacity-50"
            />

            <button
              onClick={() => submitTurn(undefined, false)}
              disabled={loading || !action.trim() || !activeCharId}
              className="bg-neutral-800 hover:bg-neutral-700 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              Act
            </button>

            <button
              onClick={() => submitTurn(undefined, true)}
              disabled={loading || !action.trim() || !activeCharId}
              className="bg-red-900 hover:bg-red-800 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              🎲 Roll & Act
            </button>
          </div>
        </div>

      </div>
    </main>
  );
}