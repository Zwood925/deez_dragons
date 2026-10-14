"use client";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CutsceneSlide {
  slide_number: number;
  narration: string;
  image_prompt: string;
  camera_motion: "kenburns-zoom-in" | "kenburns-pan-right" | "kenburns-tilt-up";
}

export interface ProloguePlayerProps {
  slides: CutsceneSlide[];
  slideIndex: number;
  slideKey: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

// ── Ken-Burns keyframe map ─────────────────────────────────────────────────────

const MOTION_STYLE: Record<CutsceneSlide["camera_motion"], React.CSSProperties> = {
  "kenburns-zoom-in": {
    animation: "kenburnsZoomIn 8s ease-out forwards",
  },
  "kenburns-pan-right": {
    animation: "kenburnsZoomIn 8s ease-out forwards",
  },
  "kenburns-tilt-up": {
    animation: "kenburnsZoomIn 8s ease-out forwards",
  },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProloguePlayer({
  slides,
  slideIndex,
  slideKey,
  onNext,
  onPrev,
  onSkip,
}: ProloguePlayerProps) {
  if (slides.length === 0) return null;

  const slide = slides[slideIndex];
  const isLast = slideIndex === slides.length - 1;

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center">
      {/* Slide background — gradient placeholder (real image would be fetched) */}
      <div
        key={slideKey}
        className="absolute inset-0 overflow-hidden"
        style={MOTION_STYLE[slide.camera_motion]}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-red-950/30 to-black" />
        {/* Decorative vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,black_100%)]" />
      </div>

      {/* Slide counter */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
        {slides.map((_, i) => (
          <div
            key={i}
            className={`h-1 rounded-full transition-all duration-500 ${
              i === slideIndex
                ? "w-8 bg-red-500"
                : i < slideIndex
                ? "w-4 bg-red-900"
                : "w-4 bg-neutral-700"
            }`}
          />
        ))}
      </div>

      {/* Narration text */}
      <div className="relative z-10 max-w-2xl px-8 text-center space-y-6">
        <p
          key={`narration-${slideKey}`}
          className="text-neutral-100 text-lg leading-relaxed font-serif italic drop-shadow-2xl"
          style={{ animation: "fadeInUp 1.2s ease-out forwards" }}
        >
          {slide.narration}
        </p>
      </div>

      {/* Navigation */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4">
        <button
          onClick={onPrev}
          disabled={slideIndex === 0}
          className="px-4 py-2 rounded-lg bg-black/60 border border-neutral-700 text-neutral-300 text-sm hover:bg-neutral-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>

        <button
          onClick={onNext}
          className="px-6 py-2 rounded-lg bg-red-900 hover:bg-red-800 border border-red-700 text-white text-sm font-semibold transition-colors"
        >
          {isLast ? "Begin Adventure →" : "Next →"}
        </button>

        <button
          onClick={onSkip}
          className="px-4 py-2 rounded-lg bg-black/60 border border-neutral-700 text-neutral-500 text-xs hover:text-neutral-300 transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Inline keyframe styles */}
      <style>{`
        @keyframes kenburnsZoomIn {
          from { transform: scale(1.0); }
          to   { transform: scale(1.08); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
