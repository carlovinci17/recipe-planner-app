import { cn } from "@/lib/utils";

/**
 * Agent faces (ADR-0008/0010 "visible delegation"): one illustrated character
 * per agent, so a reply shows WHO handled it at a glance — not just an emoji.
 *
 * One visual system for all of them: the same round face, eyes and smile on a
 * coloured disc, told apart by colour and a single accessory. Drawn inline as
 * SVG so they need no asset pipeline, stay crisp at any size, and keep their
 * colours in dark mode (they are illustrations, not UI chrome).
 */
export type AgentId =
  | "coordinator"
  | "finder"
  | "planner"
  | "shopping"
  | "chef"
  | "critic"
  | "nutrition";

export const AGENTS: Record<AgentId, { label: string; bg: string }> = {
  coordinator: { label: "Kitchen Assistant", bg: "#E8743B" },
  finder: { label: "Finder", bg: "#2A9D8F" },
  planner: { label: "Planner", bg: "#3D6FB6" },
  shopping: { label: "Shopping", bg: "#5A9E4B" },
  chef: { label: "AI Chef", bg: "#C8553D" },
  critic: { label: "Critic", bg: "#7B5EA7" },
  nutrition: { label: "Nutrition", bg: "#D4A72C" },
};

const SKIN = "#F6D7B8";
const INK = "#3B2A20";

/** The accessory that makes each face its own character. */
function Accessory({ agent }: { agent: AgentId }) {
  switch (agent) {
    case "coordinator": // chef's toque
      return (
        <g fill="#FFFFFF" stroke={INK} strokeWidth="0.8">
          <path d="M12 13.5c-2.6 0-3.6-3.6-1.2-4.8.2-2.6 3.4-3.6 5-1.8 1.4-2.2 5-2.2 6.4 0 1.6-1.8 4.8-.8 5 1.8 2.4 1.2 1.4 4.8-1.2 4.8z" />
          <rect x="12" y="12.5" width="16" height="3" rx="0.8" />
        </g>
      );
    case "finder": // round glasses
      return (
        <g fill="none" stroke={INK} strokeWidth="1.1">
          <circle cx="16" cy="19" r="2.8" />
          <circle cx="24" cy="19" r="2.8" />
          <path d="M18.8 19h2.4" />
        </g>
      );
    case "planner": // pencil tucked over the ear + neat fringe
      return (
        <g>
          <path d="M12 15.5c2-3.5 12.5-4.5 16 0-3-1.2-5.5-1.6-8-1.6s-5.4.4-8 1.6z" fill={INK} />
          <rect
            x="27"
            y="14"
            width="2"
            height="9"
            rx="0.6"
            fill="#F2C14E"
            transform="rotate(20 28 18)"
          />
        </g>
      );
    case "shopping": // baseball cap
      return (
        <g fill="#FFFFFF" stroke={INK} strokeWidth="0.8">
          <path d="M12.5 15.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5z" />
          <path d="M20 15.5h11c0 1.2-1 1.8-2.4 1.8H20z" />
        </g>
      );
    case "chef": // tall toque + moustache
      return (
        <g>
          <g fill="#FFFFFF" stroke={INK} strokeWidth="0.8">
            <path d="M13 13.5c-2.2-.4-2.6-4 0-4.6-.2-3.2 3.8-4.6 5.4-2.4 1-1.6 3.2-1.6 4.2 0 1.6-2.2 5.6-.8 5.4 2.4 2.6.6 2.2 4.2 0 4.6z" />
            <rect x="13" y="12.5" width="14" height="3" rx="0.8" />
          </g>
          <path
            d="M16.5 24.2c1.4-1.4 2.6-1.2 3.5-.2.9-1 2.1-1.2 3.5.2-1.4.2-2.6.6-3.5 0-.9.6-2.1.2-3.5 0z"
            fill={INK}
          />
        </g>
      );
    case "critic": // one raised eyebrow
      return <path d="M22 15.6l3.6-1.2" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />;
    case "nutrition": // a leaf sprouting from the head
      return (
        <g>
          <path d="M20 12.5v-3" stroke="#3E7D34" strokeWidth="1" />
          <path d="M20 9.8c.4-2.6 3.2-3.6 5-3-.4 2.4-2.6 3.6-5 3z" fill="#5A9E4B" />
        </g>
      );
  }
}

export function AgentAvatar({
  agent,
  size = 28,
  className,
}: {
  agent: AgentId;
  size?: number;
  className?: string;
}) {
  const { label, bg } = AGENTS[agent];
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={cn("shrink-0 rounded-full", className)}
    >
      <title>{label}</title>
      <circle cx="20" cy="20" r="20" fill={bg} />
      <circle cx="20" cy="21" r="9.5" fill={SKIN} />
      <circle cx="16.5" cy="19.5" r="1.1" fill={INK} />
      <circle cx="23.5" cy="19.5" r="1.1" fill={INK} />
      <path
        d="M16.8 24.6c1.8 1.6 4.6 1.6 6.4 0"
        fill="none"
        stroke={INK}
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <Accessory agent={agent} />
    </svg>
  );
}

/** Map a specialist name from /api/assistant to its face; unknown → coordinator. */
export function agentFor(specialist: string | null | undefined): AgentId {
  return specialist && specialist in AGENTS ? (specialist as AgentId) : "coordinator";
}
