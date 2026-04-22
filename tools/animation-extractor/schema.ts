// Canonical animation spec schema — the interface contract between
// tools/animation-extractor/ (producer) and tools/motion-emitter/ (consumer).
// Round F's Next.js emitter also consumes this.

export const SPEC_VERSION = "1.0" as const;

export type MotionType =
  | "fade-up" | "fade-in" | "fade-out"
  | "slide-left" | "slide-right" | "slide-up" | "slide-down"
  | "scale-in" | "scale-out"
  | "rotate"
  | "reveal-on-scroll"
  | "hover-lift" | "hover-glow"
  | "parallax"
  | "shader-ambient"
  | "typewriter"
  | "stagger"
  | "loop"
  | "one-shot"
  | "other";

export type TriggerType =
  | "on-load" | "on-mount"
  | "scroll-in" | "scroll-out" | "scroll-progress"
  | "hover" | "focus" | "click"
  | "continuous"
  | "unknown";

export type EasingType =
  | "linear" | "ease-in" | "ease-out" | "ease-in-out"
  | "spring" | "cubic-bezier"
  | "unknown";

export type Provenance = "dom" | "vision";

export interface Animation {
  id: string;
  provenance: Provenance[];
  confidence: number;
  element: string;
  selector?: string;
  role?: string;
  motion_type: MotionType;
  trigger: TriggerType;
  duration_ms: number;
  easing: EasingType;
  iterations?: number | "infinite";
  keyframes?: Array<Record<string, string | number>>;
  frames_involved?: number[];
  needs_review?: boolean;
}

export interface AnimationSpec {
  version: typeof SPEC_VERSION;
  target_url: string;
  captured_at: string;
  total: number;
  by_provenance: { dom: number; vision: number; both: number };
  by_trigger: Partial<Record<TriggerType, number>>;
  by_motion_type: Partial<Record<MotionType, number>>;
  layer_counts: { dom: number; vision: number };
  cost_usd?: number;
  warnings?: string[];
  animations: Animation[];
}

const MOTION_TYPES: readonly MotionType[] = [
  "fade-up", "fade-in", "fade-out",
  "slide-left", "slide-right", "slide-up", "slide-down",
  "scale-in", "scale-out", "rotate",
  "reveal-on-scroll", "hover-lift", "hover-glow",
  "parallax", "shader-ambient", "typewriter", "stagger",
  "loop", "one-shot", "other",
];

const TRIGGER_TYPES: readonly TriggerType[] = [
  "on-load", "on-mount",
  "scroll-in", "scroll-out", "scroll-progress",
  "hover", "focus", "click",
  "continuous", "unknown",
];

const EASING_TYPES: readonly EasingType[] = [
  "linear", "ease-in", "ease-out", "ease-in-out",
  "spring", "cubic-bezier", "unknown",
];

// Map the coarse categories produced by Round D's Vision prompt
// (+ optional direction hint) → canonical MotionType.
export function normalizeMotionType(
  visionType: string | null | undefined,
  direction?: string | null,
  trigger?: string | null,
): MotionType {
  const v = (visionType || "").toLowerCase().trim();
  const d = (direction || "").toLowerCase().trim();
  const t = (trigger || "").toLowerCase().trim();

  // Already canonical — accept as-is.
  if ((MOTION_TYPES as readonly string[]).includes(v)) return v as MotionType;

  if (v === "fade") {
    if (d === "up") return "fade-up";
    if (d === "out" || t === "scroll-out") return "fade-out";
    return "fade-in";
  }
  if (v === "slide") {
    if (d === "left") return "slide-left";
    if (d === "right") return "slide-right";
    if (d === "down") return "slide-down";
    return "slide-up";
  }
  if (v === "scale") {
    return d === "out" ? "scale-out" : "scale-in";
  }
  if (v === "rotate") return "rotate";
  if (v === "reveal" || v === "morph") return "reveal-on-scroll";
  if (v === "parallax") return "parallax";
  if (v === "shader-webgl" || v === "shader") return "shader-ambient";
  if (v === "stagger") return "stagger";
  if (v === "typewriter") return "typewriter";
  if (v === "blur" || v === "color-shift") return "other";
  return "other";
}

export function normalizeTrigger(trigger: string | null | undefined): TriggerType {
  const t = (trigger || "").toLowerCase().trim();
  return (TRIGGER_TYPES as readonly string[]).includes(t) ? (t as TriggerType) : "unknown";
}

export function normalizeEasing(easing: string | null | undefined): EasingType {
  const e = (easing || "").toLowerCase().trim();
  if (!e || e === "none") return "unknown";
  if (e.startsWith("cubic-bezier")) return "cubic-bezier";
  if ((EASING_TYPES as readonly string[]).includes(e)) return e as EasingType;
  return "unknown";
}

// Stable content-addressed ID so the same animation across re-runs gets the same id.
export function animationId(fields: {
  element: string;
  motion_type: string;
  trigger: string;
  duration_ms: number;
}): string {
  const key = `${fields.element}|${fields.motion_type}|${fields.trigger}|${fields.duration_ms}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `anim-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export class SpecValidationError extends Error {}

export function validateSpec(spec: unknown): AnimationSpec {
  if (!spec || typeof spec !== "object") {
    throw new SpecValidationError("spec must be an object");
  }
  const s = spec as Record<string, unknown>;
  if (s.version !== SPEC_VERSION) {
    throw new SpecValidationError(`unsupported spec version ${String(s.version)}; expected ${SPEC_VERSION}`);
  }
  if (typeof s.target_url !== "string") {
    throw new SpecValidationError("spec.target_url must be a string");
  }
  if (!Array.isArray(s.animations)) {
    throw new SpecValidationError("spec.animations must be an array");
  }
  for (let i = 0; i < s.animations.length; i++) {
    const a = s.animations[i] as Record<string, unknown>;
    if (typeof a?.id !== "string") throw new SpecValidationError(`animations[${i}].id missing`);
    if (!Array.isArray(a?.provenance) || a.provenance.length === 0) {
      throw new SpecValidationError(`animations[${i}].provenance must be non-empty array`);
    }
    if (!(MOTION_TYPES as readonly string[]).includes(String(a?.motion_type))) {
      throw new SpecValidationError(`animations[${i}].motion_type invalid: ${String(a?.motion_type)}`);
    }
  }
  return spec as AnimationSpec;
}
