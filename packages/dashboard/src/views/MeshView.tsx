import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as d3 from 'd3';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCortivexStore } from '@/stores/cortivexStore';

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

type VisualRole = 'leader' | 'follower' | 'candidate' | 'dead';
type PType = 'heartbeat' | 'vote' | 'task' | 'knowledge' | 'error';

interface SimAgent {
  id: string;
  name: string;
  role: VisualRole;
  status: 'idle' | 'working' | 'dead';
  tokensUsed: number;
  health: number;
}

interface SimEvent {
  id: string;
  type: string;
  agent: string;
  details: string;
  timestamp: string;
}

interface TrailPt {
  x: number;
  y: number;
}

interface Particle {
  id: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  cpx: number;
  cpy: number;
  color: string;
  size: number;
  startTime: number;
  duration: number;
  trail: TrailPt[];
}

interface Ripple {
  x: number;
  y: number;
  color: string;
  startTime: number;
  duration: number;
  maxRadius: number;
  startOpacity: number;
}

interface SNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  role: VisualRole;
  status: string;
  tokensUsed: number;
  health: number;
}

interface SLink extends d3.SimulationLinkDatum<SNode> {
  source: SNode;
  target: SNode;
}

/* ═══════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════ */

const CARD_W = 180;
const CARD_H = 72;
const CARD_R = 12;

const ROLE_COLORS: Record<
  VisualRole,
  { accent: string; bg: string; stroke: string; text: string }
> = {
  leader: {
    accent: '#E8A44A',
    bg: '#1E1D18',
    stroke: '#E8A44A',
    text: '#E8A44A',
  },
  follower: {
    accent: '#4F8EF7',
    bg: '#161A24',
    stroke: '#4F8EF7',
    text: '#4F8EF7',
  },
  candidate: {
    accent: '#E8A44A',
    bg: '#1E1D18',
    stroke: '#E8A44A',
    text: '#E8A44A',
  },
  dead: {
    accent: '#E05C5C',
    bg: '#141416',
    stroke: '#E05C5C',
    text: '#5A6478',
  },
};

const ROLE_ICONS: Record<VisualRole, string> = {
  leader:
    'M9 2l2.3 4.7L16 7.7l-3.5 3.4.8 4.9L9 13.8 4.7 16l.8-4.9L2 7.7l4.7-1L9 2z',
  follower: 'M4 4h4v4H4zM12 4h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4z',
  candidate:
    'M9 2l2.3 4.7L16 7.7l-3.5 3.4.8 4.9L9 13.8 4.7 16l.8-4.9L2 7.7l4.7-1L9 2z',
  dead: 'M18 6L6 18M6 6l12 12',
};

const PARTICLE_CFG: Record<PType, { color: string; size: number }> = {
  heartbeat: { color: '#5A6478', size: 2 },
  vote: { color: '#E8A44A', size: 3.5 },
  task: { color: '#4F8EF7', size: 3 },
  knowledge: { color: '#3DD68C', size: 2.5 },
  error: { color: '#E05C5C', size: 3 },
};

const EVENT_COLORS: Record<string, string> = {
  BOOTSTRAP: '#4F8EF7',
  ELECTION: '#E8A44A',
  VOTE: '#E8A44A',
  LEADER: '#E8A44A',
  HEARTBEAT: '#5A6478',
  DEATH: '#E05C5C',
  RESPAWN: '#3DD68C',
  TASK: '#4F8EF7',
  QUORUM: '#7B6EF6',
};

// Default agents used when WebSocket bootstrap provides agent list
const DEFAULT_AGENTS: SimAgent[] = [
  { id: 'alpha', name: 'Alpha', role: 'follower', status: 'idle', tokensUsed: 0, health: 1 },
  { id: 'beta', name: 'Beta', role: 'follower', status: 'idle', tokensUsed: 0, health: 1 },
  { id: 'gamma', name: 'Gamma', role: 'follower', status: 'idle', tokensUsed: 0, health: 1 },
  { id: 'delta', name: 'Delta', role: 'follower', status: 'idle', tokensUsed: 0, health: 1 },
  { id: 'epsilon', name: 'Epsilon', role: 'follower', status: 'idle', tokensUsed: 0, health: 1 },
];

// Start empty — populated from store mesh events or simulation bootstrap
const INIT_AGENTS: SimAgent[] = [];

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

function fmtTok(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

function qBez(
  t: number,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  tx: number,
  ty: number,
): [number, number] {
  const m = 1 - t;
  return [
    m * m * sx + 2 * m * t * cx + t * t * tx,
    m * m * sy + 2 * m * t * cy + t * t * ty,
  ];
}

function easeIO(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ═══════════════════════════════════════════════════════════
   Module-level position cache
   ═══════════════════════════════════════════════════════════ */

const posCache = new Map<string, { x: number; y: number }>();

/* ═══════════════════════════════════════════════════════════
   MeshView Component
   ═══════════════════════════════════════════════════════════ */

export function MeshView() {
  const { meshEvents: storeMeshEvents } = useCortivexStore();
  const [agents, setAgents] = useState<SimAgent[]>(INIT_AGENTS);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [cluster, setCluster] = useState({ term: 0, leaderId: '' });
  const [panelOpen, setPanelOpen] = useState(true);

  // Derive agents directly from mesh events (no ref gate — works with strict mode)
  useEffect(() => {
    if (storeMeshEvents.length === 0) return;

    // Extract unique agent names from all events
    const agentNames = new Set<string>();
    for (const e of storeMeshEvents) {
      if (e.agentName && e.agentName !== 'System' && e.agentName !== 'Monitor' && e.agentName !== 'SwarmSimulator') {
        agentNames.add(e.agentName);
      }
    }

    if (agentNames.size > 0) {
      // Build agents from event data — re-derive on every change
      const discovered: SimAgent[] = Array.from(agentNames).map((name) => {
        // Find ALL events for this agent to build accurate state
        const agentEvents = storeMeshEvents.filter((e) => e.agentName === name);
        const latest = agentEvents[0]; // events are newest-first
        const details = latest?.details ?? '';
        const allDetails = agentEvents.map(e => e.details).join(' ').toLowerCase();
        const isLeader = allDetails.includes('leader');
        const isDead = allDetails.includes('died') || allDetails.includes('dead');
        const tokenMatch = details.match(/([\d.]+)K?\s*tokens/i);
        const tokens = tokenMatch ? parseFloat(tokenMatch[1]) * (details.includes('K') ? 1000 : 1) : 0;

        return {
          id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          name,
          role: isDead ? 'dead' as const : isLeader ? 'leader' as const : 'follower' as const,
          status: 'idle' as const,
          tokensUsed: tokens,
          health: isDead ? 0 : 1,
        };
      });

      setAgents(discovered);
    }

    // Sync events to the panel
    const simEvents: SimEvent[] = storeMeshEvents.map((e) => ({
      id: e.id,
      type: e.type,
      agent: e.agentName,
      details: e.details,
      timestamp: e.timestamp,
    }));
    setEvents(simEvents);
  }, [storeMeshEvents]);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const simRef = useRef<d3.Simulation<SNode, SLink> | null>(null);
  const nodesRef = useRef<SNode[]>([]);
  const linksRef = useRef<SLink[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const pidRef = useRef(0);
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const tfRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const activeLinkRef = useRef<Map<string, number>>(new Map());
  const setupDoneRef = useRef(false);
  const linkGRef = useRef<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);
  const nodeGRef = useRef<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const fingerprint = useMemo(
    () =>
      agents.map((a) => `${a.id}|${a.role}|${a.status}|${a.tokensUsed}`).join('~'),
    [agents],
  );

  /* ── Add event ── */
  const addEvent = useCallback(
    (type: string, agent: string, details: string) => {
      setEvents((prev) =>
        [
          {
            id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            type,
            agent,
            details,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 80),
      );
    },
    [],
  );

  /* ── Spawn particle ── */
  const spawnParticle = useCallback(
    (srcId: string, tgtId: string, type: PType) => {
      const sn = nodesRef.current.find((n) => n.id === srcId);
      const tn = nodesRef.current.find((n) => n.id === tgtId);
      if (!sn || !tn || sn.x == null || tn.x == null) return;

      const sx = sn.x! + CARD_W / 2,
        sy = sn.y!;
      const tx = tn.x! - CARD_W / 2,
        ty = tn.y!;
      const dx = tx - sx,
        dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const px = -dy / dist,
        py = dx / dist;
      const off =
        (15 + Math.random() * 10) * (Math.random() < 0.5 ? 1 : -1);
      const cfg = PARTICLE_CFG[type];

      const key = [srcId, tgtId].sort().join('::');
      activeLinkRef.current.set(key, performance.now());

      particlesRef.current.push({
        id: pidRef.current++,
        sx,
        sy,
        tx,
        ty,
        cpx: (sx + tx) / 2 + px * off,
        cpy: (sy + ty) / 2 + py * off,
        color: cfg.color,
        size: cfg.size,
        startTime: performance.now(),
        duration: 600 + Math.random() * 300,
        trail: [],
      });
    },
    [],
  );

  /* ═══════════════════════════════════════════════════════════
     No client-side simulation — events come from the WebSocket
     (server-side SwarmSimulator broadcasts during real pipeline runs)
     ═══════════════════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════════════════
     EFFECT 1: One-time SVG + Canvas setup
     ═══════════════════════════════════════════════════════════ */

  useEffect(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    const canvas = canvasRef.current;
    if (!container || !svg || !canvas) return;

    const W = container.clientWidth;
    const H = container.clientHeight;
    sizeRef.current = { w: W, h: H };

    // Canvas
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctxRef.current = ctx;

    // SVG
    const S = d3.select(svg).attr('width', W).attr('height', H);
    S.selectAll('*').remove();

    // Glow filters
    const defs = S.append('defs');
    for (const [role, colors] of Object.entries(ROLE_COLORS)) {
      if (role === 'dead') continue;
      const f = defs
        .append('filter')
        .attr('id', `glow-${role}`)
        .attr('x', '-30%')
        .attr('y', '-30%')
        .attr('width', '160%')
        .attr('height', '160%');
      f.append('feGaussianBlur')
        .attr('in', 'SourceGraphic')
        .attr('stdDeviation', 8)
        .attr('result', 'blur');
      f.append('feColorMatrix')
        .attr('in', 'blur')
        .attr('type', 'matrix')
        .attr(
          'values',
          '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.15 0',
        )
        .attr('result', 'glow');
      const mg = f.append('feMerge');
      mg.append('feMergeNode').attr('in', 'glow');
      mg.append('feMergeNode').attr('in', 'SourceGraphic');
    }

    // Zoom
    const mainG = S.append('g');
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (e) => {
        mainG.attr('transform', e.transform.toString());
        tfRef.current = e.transform;
      });
    S.call(zoom);

    linkGRef.current = mainG.append('g');
    nodeGRef.current = mainG.append('g');

    // ── Canvas particle render loop ──
    function render() {
      const ctx = ctxRef.current;
      if (!ctx) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      const { w, h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      const tf = tfRef.current;

      ctx.save();
      ctx.translate(tf.x, tf.y);
      ctx.scale(tf.k, tf.k);

      // Particles
      particlesRef.current = particlesRef.current.filter((p) => {
        const elapsed = now - p.startTime;
        if (elapsed > p.duration) {
          ripplesRef.current.push({
            x: p.tx,
            y: p.ty,
            color: p.color,
            startTime: now,
            duration: 300,
            maxRadius: 15,
            startOpacity: 0.4,
          });
          return false;
        }

        const raw = elapsed / p.duration;
        const t = easeIO(raw);
        const [px, py] = qBez(t, p.sx, p.sy, p.cpx, p.cpy, p.tx, p.ty);

        p.trail.push({ x: px, y: py });
        if (p.trail.length > 6) p.trail.shift();

        // Trail
        for (let i = 0; i < p.trail.length - 1; i++) {
          const pt = p.trail[i];
          const frac = i / p.trail.length;
          ctx.beginPath();
          ctx.arc(
            pt.x,
            pt.y,
            p.size * (0.2 + frac * 0.8),
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = rgba(p.color, frac * frac * 0.6);
          ctx.fill();
        }

        // Body glow
        const alpha =
          raw < 0.1 ? raw / 0.1 : raw > 0.9 ? (1 - raw) / 0.1 : 1;
        const grd = ctx.createRadialGradient(
          px,
          py,
          0,
          px,
          py,
          p.size * 1.5,
        );
        grd.addColorStop(0, rgba('#ffffff', alpha * 0.8));
        grd.addColorStop(0.4, rgba(p.color, alpha));
        grd.addColorStop(1, rgba(p.color, 0));
        ctx.beginPath();
        ctx.arc(px, py, p.size * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        return true;
      });

      // Ripples
      ripplesRef.current = ripplesRef.current.filter((r) => {
        const e = now - r.startTime;
        if (e > r.duration) return false;
        const p = e / r.duration;
        ctx.beginPath();
        ctx.arc(r.x, r.y, p * r.maxRadius, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(r.color, r.startOpacity * (1 - p));
        ctx.lineWidth = 1.5 * (1 - p);
        ctx.stroke();
        return true;
      });

      ctx.restore();
      rafRef.current = requestAnimationFrame(render);
    }
    rafRef.current = requestAnimationFrame(render);

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: rw, height: rh } = entry.contentRect;
        sizeRef.current = { w: rw, h: rh };
        S.attr('width', rw).attr('height', rh);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rw * dpr;
        canvas.height = rh * dpr;
        canvas.style.width = `${rw}px`;
        canvas.style.height = `${rh}px`;
        const nc = canvas.getContext('2d')!;
        nc.scale(dpr, dpr);
        ctxRef.current = nc;
        if (simRef.current) {
          simRef.current.force(
            'center',
            d3.forceCenter(rw / 2, rh / 2).strength(0.08),
          );
          simRef.current.alpha(0.1).restart();
          setTimeout(() => {
            if (simRef.current) simRef.current.stop();
          }, 1500);
        }
      }
    });
    ro.observe(container);

    setupDoneRef.current = true;

    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      setupDoneRef.current = false;
    };
  }, []);

  /* ═══════════════════════════════════════════════════════════
     EFFECT 2: Data sync — incremental D3 updates
     ═══════════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!setupDoneRef.current || !linkGRef.current || !nodeGRef.current)
      return;
    const linkG = linkGRef.current;
    const nodeG = nodeGRef.current;

    const { w: W, h: H } = sizeRef.current;
    if (W === 0 || H === 0) return;

    const isInitial = posCache.size === 0;

    // Build sim nodes
    const simNodes: SNode[] = agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      tokensUsed: a.tokensUsed,
      health: a.health,
      x: posCache.get(a.id)?.x ?? W / 2 + (Math.random() - 0.5) * 300,
      y: posCache.get(a.id)?.y ?? H / 2 + (Math.random() - 0.5) * 200,
    }));

    // Links: all alive nodes interconnected
    const simLinks: SLink[] = [];
    const alive = simNodes.filter((n) => n.role !== 'dead');
    for (let i = 0; i < alive.length; i++)
      for (let j = i + 1; j < alive.length; j++)
        simLinks.push({ source: alive[i], target: alive[j] });

    // Fix dead positions
    for (const n of simNodes) {
      if (n.role === 'dead') {
        n.fx = n.x;
        n.fy = n.y;
      }
    }

    nodesRef.current = simNodes;
    linksRef.current = simLinks;

    if (simRef.current) simRef.current.stop();

    // ── Links data join ──
    const lSel = linkG
      .selectAll<SVGGElement, SLink>('g.mesh-link')
      .data(simLinks, (d: any) => {
        const sid =
          typeof d.source === 'object' ? d.source.id : d.source;
        const tid =
          typeof d.target === 'object' ? d.target.id : d.target;
        return `${sid}::${tid}`;
      });

    lSel.exit().transition().duration(400).attr('opacity', 0).remove();

    const lEnt = lSel.enter().append('g').attr('class', 'mesh-link');
    lEnt.append('path').attr('class', 'link-line');
    lEnt.append('polygon').attr('class', 'link-arrow');

    // ── Nodes data join ──
    const nSel = nodeG
      .selectAll<SVGGElement, SNode>('g.mesh-node')
      .data(simNodes, (d) => d.id);

    nSel.exit().transition().duration(600).attr('opacity', 0).remove();

    const nEnt = nSel
      .enter()
      .append('g')
      .attr('class', 'mesh-node')
      .attr('opacity', 0);

    nEnt.transition().duration(600).attr('opacity', 1);

    // Build card for NEW nodes
    nEnt.each(function (d) {
      const g = d3.select(this);
      const rc = ROLE_COLORS[d.role];
      const isDead = d.role === 'dead';
      const hw = CARD_W / 2,
        hh = CARD_H / 2;

      // Subtle glow
      if (!isDead) {
        g.insert('rect', ':first-child')
          .attr('class', 'card-glow')
          .attr('x', -hw - 4)
          .attr('y', -hh - 4)
          .attr('width', CARD_W + 8)
          .attr('height', CARD_H + 8)
          .attr('rx', CARD_R + 4)
          .attr('ry', CARD_R + 4)
          .attr('fill', rc.accent)
          .attr('opacity', 0.08);
      }

      // Card background
      g.append('rect')
        .attr('class', 'card-bg')
        .attr('x', -hw)
        .attr('y', -hh)
        .attr('width', CARD_W)
        .attr('height', CARD_H)
        .attr('rx', CARD_R)
        .attr('ry', CARD_R)
        .attr('fill', rc.bg)
        .attr('stroke', rc.stroke)
        .attr('stroke-width', isDead ? 1 : 1.5)
        .attr('stroke-opacity', isDead ? 0.3 : 0.4)
        .attr('opacity', isDead ? 0.4 : 1);

      // Left accent bar
      g.append('rect')
        .attr('class', 'accent-bar')
        .attr('x', -hw)
        .attr('y', -hh + CARD_R)
        .attr('width', 3)
        .attr('height', CARD_H - CARD_R * 2)
        .attr('fill', rc.accent)
        .attr('rx', 1);

      // Role icon
      g.append('path')
        .attr('class', 'role-icon')
        .attr('d', ROLE_ICONS[d.role])
        .attr(
          'transform',
          `translate(${-hw + 12}, ${-hh + 10}) scale(0.7)`,
        )
        .attr('fill', rc.accent)
        .attr('stroke', d.role === 'dead' ? '#5A6478' : 'none')
        .attr('stroke-width', d.role === 'dead' ? 1.5 : 0)
        .attr('fill', d.role === 'dead' ? 'none' : rc.accent);

      // Agent name
      g.append('text')
        .attr('class', 'agent-name')
        .attr('x', -hw + 28)
        .attr('y', -hh + 22)
        .attr('fill', isDead ? '#353D4F' : '#CDD5E0')
        .attr('font-size', '11px')
        .attr('font-family', '"Space Mono", monospace')
        .text(d.name);

      // Role text
      g.append('text')
        .attr('class', 'role-text')
        .attr('x', -hw + 10)
        .attr('y', -hh + 50)
        .attr('fill', rc.text)
        .attr('font-size', '9px')
        .attr('font-family', '"Space Mono", monospace')
        .attr('opacity', 0.7)
        .text(d.role.toUpperCase());

      // Token text
      g.append('text')
        .attr('class', 'token-text')
        .attr('x', -hw + 10)
        .attr('y', -hh + 63)
        .attr('fill', '#5A6478')
        .attr('font-size', '9px')
        .attr('font-family', '"Space Mono", monospace')
        .text(`${fmtTok(d.tokensUsed)} tokens`);

      // Input port (left)
      g.append('circle')
        .attr('cx', -hw)
        .attr('cy', 0)
        .attr('r', 4)
        .attr('fill', '#12151E')
        .attr('stroke', '#353D4F')
        .attr('stroke-width', 1);

      // Output port (right)
      g.append('circle')
        .attr('cx', hw)
        .attr('cy', 0)
        .attr('r', 4)
        .attr('fill', '#12151E')
        .attr('stroke', '#353D4F')
        .attr('stroke-width', 1);
    });

    // UPDATE existing nodes (role/status changes)
    nSel.each(function (d) {
      const g = d3.select(this);
      const rc = ROLE_COLORS[d.role];
      const isDead = d.role === 'dead';

      g.select('.card-bg')
        .attr('stroke', rc.stroke)
        .attr('fill', rc.bg)
        .attr('opacity', isDead ? 0.4 : 1)
        .attr('stroke-opacity', isDead ? 0.3 : 0.4)
        .attr('stroke-width', isDead ? 1 : 1.5);

      g.select('.accent-bar').attr('fill', rc.accent);

      g.select('.role-icon')
        .attr('d', ROLE_ICONS[d.role])
        .attr('fill', isDead ? 'none' : rc.accent)
        .attr('stroke', isDead ? '#5A6478' : 'none')
        .attr('stroke-width', isDead ? 1.5 : 0);

      g.select('.agent-name').attr('fill', isDead ? '#353D4F' : '#CDD5E0');

      g.select('.role-text')
        .text(d.role.toUpperCase())
        .attr('fill', rc.text);

      g.select('.token-text').text(`${fmtTok(d.tokensUsed)} tokens`);

      // Update glow
      const glow = g.select('.card-glow');
      if (isDead) {
        glow.attr('opacity', 0);
      } else {
        glow.attr('fill', rc.accent).attr('opacity', 0.08);
      }
    });

    // Merged for position updates
    const nAll = nEnt.merge(nSel);

    // Drag on new nodes
    nEnt.call(
      d3
        .drag<SVGGElement, SNode>()
        .on('start', (e, d) => {
          if (!e.active && simRef.current)
            simRef.current.alphaTarget(0.1).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (e, d) => {
          d.fx = e.x;
          d.fy = e.y;
        })
        .on('end', (e, d) => {
          if (!e.active && simRef.current) simRef.current.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    // ── Force simulation ──
    const sim = d3
      .forceSimulation<SNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SNode, SLink>(simLinks)
          .id((d) => d.id)
          .distance(220)
          .strength(0.5),
      )
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.15))
      .force(
        'collision',
        d3.forceCollide<SNode>().radius(CARD_W / 2 + 30).strength(1),
      )
      .force('x', d3.forceX(W / 2).strength(0.08))
      .force('y', d3.forceY(H / 2).strength(0.08))
      .alphaDecay(0.08)
      .velocityDecay(0.6)
      .alphaMin(0.01)
      .alpha(isInitial ? 0.3 : 0.02)
      .on('tick', tick);
    simRef.current = sim;

    const freezeTimer = setTimeout(
      () => sim.stop(),
      isInitial ? 3000 : 1000,
    );

    function tick() {
      const now = performance.now();

      // Cache positions
      for (const n of simNodes) {
        if (n.x != null && n.y != null)
          posCache.set(n.id, { x: n.x, y: n.y });
      }

      // Update links
      linkG
        .selectAll<SVGGElement, SLink>('g.mesh-link')
        .each(function (d) {
          const g = d3.select(this);
          const sx = d.source.x! + CARD_W / 2,
            sy = d.source.y!;
          const tx = d.target.x! - CARD_W / 2,
            ty = d.target.y!;
          const dx = tx - sx,
            dy = ty - sy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / dist,
            ny = dx / dist;
          const cpx = (sx + tx) / 2 + nx * 25;
          const cpy = (sy + ty) / 2 + ny * 25;

          const key = [d.source.id, d.target.id].sort().join('::');
          const lastActive = activeLinkRef.current.get(key);
          let opacity = 0.15;
          let strokeColor = '#1A1F2E';
          let strokeWidth = 1;
          if (lastActive !== undefined) {
            const age = now - lastActive;
            if (age < 1000) {
              opacity = 0.5 * (1 - age / 1000);
              strokeColor = '#4F8EF7';
              strokeWidth = 1.5;
            } else {
              activeLinkRef.current.delete(key);
            }
          }

          g.select('.link-line')
            .attr('d', `M${sx},${sy} Q${cpx},${cpy} ${tx},${ty}`)
            .attr('fill', 'none')
            .attr('stroke', strokeColor)
            .attr('stroke-width', strokeWidth)
            .attr('stroke-opacity', Math.max(0.08, opacity));

          const [mx, my] = qBez(0.5, sx, sy, cpx, cpy, tx, ty);
          const angle = Math.atan2(ty - sy, tx - sx);
          const aSize = 4;
          const p1x = mx + Math.cos(angle) * aSize;
          const p1y = my + Math.sin(angle) * aSize;
          const p2x = mx + Math.cos(angle + 2.5) * aSize;
          const p2y = my + Math.sin(angle + 2.5) * aSize;
          const p3x = mx + Math.cos(angle - 2.5) * aSize;
          const p3y = my + Math.sin(angle - 2.5) * aSize;
          g.select('.link-arrow')
            .attr(
              'points',
              `${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`,
            )
            .attr('fill', strokeColor)
            .attr('opacity', Math.max(0.08, opacity));
        });

      // Update node positions
      nAll.attr('transform', (d) => `translate(${d.x},${d.y})`);
    }

    // Auto-fit zoom on initial layout
    if (isInitial) {
      setTimeout(() => {
        if (!simNodes.length) return;
        const svgEl = svgRef.current;
        if (!svgEl) return;
        let x0 = Infinity,
          x1 = -Infinity,
          y0 = Infinity,
          y1 = -Infinity;
        for (const n of simNodes) {
          if (n.x == null) continue;
          x0 = Math.min(x0, n.x - CARD_W / 2 - 20);
          x1 = Math.max(x1, n.x + CARD_W / 2 + 20);
          y0 = Math.min(y0, n.y! - CARD_H / 2 - 20);
          y1 = Math.max(y1, n.y! + CARD_H / 2 + 20);
        }
        const bw = x1 - x0,
          bh = y1 - y0;
        if (bw <= 0 || bh <= 0) return;
        const sc = Math.max(
          0.5,
          Math.min(W / (bw * 1.15), H / (bh * 1.15), 1.2),
        );
        const tf = d3.zoomIdentity
          .translate(W / 2, H / 2)
          .scale(sc)
          .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
        const S = d3.select(svgEl);
        const zoom = d3.zoom<SVGSVGElement, unknown>();
        S.transition()
          .duration(800)
          .call(zoom.transform as any, tf);
        tfRef.current = tf;
      }, 1500);
    }

    return () => {
      clearTimeout(freezeTimer);
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  /* ═══════════════════════════════════════════════════════════
     JSX
     ═══════════════════════════════════════════════════════════ */

  const aliveCount = agents.filter((a) => a.role !== 'dead').length;
  const deadCount = agents.filter((a) => a.role === 'dead').length;
  const leader = agents.find((a) => a.role === 'leader');

  const hasAgents = agents.length > 0;

  return (
    <div className="w-full h-full relative">
      {/* Empty state — shown when no pipeline is running */}
      {!hasAgents && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-surface-light border border-canvas-border flex items-center justify-center">
              <Activity size={28} className="text-text-dim" />
            </div>
            <h2 className="text-text-primary font-mono text-sm font-semibold mb-2">
              No active agents
            </h2>
            <p className="text-text-muted font-mono text-xs leading-relaxed">
              Run a pipeline to see real-time coordination.
              Agent consensus, elections, and task distribution
              will appear here during execution.
            </p>
          </div>
        </div>
      )}

      {/* Main visualization area — only rendered when agents exist */}
      {hasAgents && (
        <>
          <div
            ref={containerRef}
            className="absolute inset-0"
            style={{
              right: panelOpen ? 320 : 0,
              transition: 'right 0.3s ease',
            }}
          >
            <svg
              ref={svgRef}
              className="absolute inset-0"
              style={{ zIndex: 1 }}
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 pointer-events-none"
              style={{ zIndex: 2 }}
            />
          </div>

          {/* Legend */}
          <div className="absolute top-4 left-4 z-10 panel p-3">
            <div className="text-label uppercase text-text-muted mb-2 font-mono">
              Nodes
            </div>
            <div className="flex flex-col gap-1.5">
              <LegendItem color="#E8A44A" label="Leader" />
              <LegendItem color="#4F8EF7" label="Follower" />
              <LegendItem color="#E8A44A" label="Candidate" dashed />
              <LegendItem
                color="#E05C5C"
                label={`Dead${deadCount > 0 ? ` (${deadCount})` : ''}`}
              />
              <div className="h-px bg-canvas-border my-1" />
              <div className="text-label uppercase text-text-muted mb-1 font-mono">
                Particles
              </div>
              <ParticleItem color="#E8A44A" label="Vote" />
              <ParticleItem color="#5A6478" label="Heartbeat" />
              <ParticleItem color="#4F8EF7" label="Task" />
              <ParticleItem color="#3DD68C" label="Knowledge" />
            </div>
          </div>

          {/* Stats badge */}
          <div
            className="absolute top-4 z-10 panel px-4 py-2.5"
            style={{
              right: panelOpen ? 336 : 16,
              transition: 'right 0.3s ease',
            }}
          >
            <span className="text-cortivex-cyan font-mono font-bold text-lg mr-1">
              {aliveCount}
            </span>
            <span className="text-text-muted font-mono text-xs">
              active agents
            </span>
            {leader && (
              <div className="text-warning-amber font-mono text-[10px] mt-0.5">
                Leader: {leader.name} (term {cluster.term})
              </div>
            )}
            {!leader && cluster.term > 0 && (
              <div className="text-error-coral font-mono text-[10px] mt-0.5 animate-pulse-alive">
                ELECTION IN PROGRESS (term {cluster.term})
              </div>
            )}
          </div>

          {/* Election banner */}
          <AnimatePresence>
            {agents.some((a) => a.role === 'candidate') && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="absolute top-16 left-1/2 -translate-x-1/2 z-10 panel px-6 py-2 border border-warning-amber/30"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-warning-amber animate-pulse-alive" />
                  <span className="text-warning-amber font-mono text-xs font-bold uppercase tracking-wider">
                    Leader Election in Progress
                  </span>
                  <span className="text-text-muted font-mono text-[10px]">
                    Term {cluster.term}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Event panel toggle */}
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className="absolute top-1/2 -translate-y-1/2 z-20 w-6 h-12 rounded-l-lg bg-surface-light border border-canvas-border border-r-0 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            style={{
              right: panelOpen ? 320 : 0,
              transition: 'right 0.3s ease',
            }}
          >
            {panelOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          {/* Event panel */}
          <EventPanel events={events} open={panelOpen} />
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Event Panel
   ═══════════════════════════════════════════════════════════ */

function EventPanel({
  events,
  open,
}: {
  events: SimEvent[];
  open: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="absolute top-0 right-0 bottom-0 w-80 bg-surface border-l border-canvas-border z-10 flex flex-col"
      style={{
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease',
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-canvas-border">
        <Activity size={14} className="text-cortivex-cyan" />
        <span className="text-label uppercase text-text-muted font-mono">
          Event Log
        </span>
        <span className="badge-cyan text-[9px] ml-auto">{events.length}</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {events.map((evt, i) => {
          const color = EVENT_COLORS[evt.type] || '#5A6478';
          const time = new Date(evt.timestamp).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });

          return (
            <motion.div
              key={evt.id}
              className="flex items-start gap-2 px-2 py-1 rounded hover:bg-white/5 transition-colors"
              initial={i === 0 ? { opacity: 0, x: 10 } : false}
              animate={{ opacity: 1, x: 0 }}
            >
              <span className="text-[9px] font-mono text-text-dim mt-0.5 whitespace-nowrap">
                {time}
              </span>
              <span
                className="text-[9px] font-mono font-semibold mt-0.5 whitespace-nowrap"
                style={{ color }}
              >
                [{evt.type}]
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] text-text-muted">
                  <span className="text-text-primary font-medium">
                    {evt.agent}
                  </span>{' '}
                  {evt.details}
                </span>
              </div>
            </motion.div>
          );
        })}
        {events.length === 0 && (
          <div className="text-center text-text-dim text-xs font-mono py-8">
            Waiting for events...
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Legend Components
   ═══════════════════════════════════════════════════════════ */

function LegendItem({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <div
        className="w-3 h-2 rounded-sm"
        style={{
          backgroundColor: dashed ? 'transparent' : color,
          border: dashed ? `1px dashed ${color}` : 'none',
        }}
      />
      <span className="text-text-muted">{label}</span>
    </div>
  );
}

function ParticleItem({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <div
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
      />
      <span className="text-text-muted">{label}</span>
    </div>
  );
}
