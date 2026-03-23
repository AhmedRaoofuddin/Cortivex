import { create } from 'zustand';
import type {
  PipelineDefinition,
  PipelineRun,
  PipelineNode,
  PipelineConnection,
  MeshClaim,
  MeshConflict,
  MeshEvent,
  Insight,
  ExecutionRecord,
  ViewType,
  NodeStatus,
  Suggestion,
} from '@/lib/types';
import {
  demoPipelines,
  demoHistory,
  demoInsights,
  demoMeshClaims,
  demoMeshConflicts,
  demoMeshEvents,
  demoSuggestions,
  createLiveExecution,
} from '@/lib/demo-data';
import {
  fetchPipelines as apiFetchPipelines,
  fetchMeshClaims as apiFetchMeshClaims,
  fetchMeshConflicts as apiFetchMeshConflicts,
  fetchInsights as apiFetchInsights,
  fetchHistory as apiFetchHistory,
} from '@/lib/api';

// ============================================
// STATE INTERFACE
// ============================================

export interface CortivexState {
  // Pipeline state
  pipelines: PipelineDefinition[];
  activePipeline: PipelineDefinition | null;
  activeRun: PipelineRun | null;

  // Mesh state
  meshClaims: MeshClaim[];
  meshConflicts: MeshConflict[];
  meshEvents: MeshEvent[];

  // Learning state
  insights: Insight[];
  history: ExecutionRecord[];
  suggestions: Suggestion[];

  // UI state
  activeView: ViewType;
  selectedNode: string | null;
  isConfigPanelOpen: boolean;
  isConnected: boolean;
  isSidebarExpanded: boolean;
  isLoading: boolean;

  // Editor state
  editorNodes: PipelineNode[];
  editorConnections: PipelineConnection[];
  editorPipelineName: string;

  // Execution state
  executionSimulation: ReturnType<typeof createLiveExecution> | null;
  terminalOutput: { nodeId: string; lines: { type: string; text: string }[] }[];
  activeTerminalTab: string | null;

  // Actions — Data loading
  fetchInitialData: () => Promise<void>;

  // Actions — Pipeline
  loadPipelines: () => void;
  setActivePipeline: (pipeline: PipelineDefinition | null) => void;
  runPipeline: (name: string) => void;
  updateActiveRun: (run: Partial<PipelineRun>) => void;
  stopExecution: () => void;

  // Actions — Editor
  addEditorNode: (node: PipelineNode) => void;
  removeEditorNode: (nodeId: string) => void;
  updateEditorNode: (nodeId: string, updates: Partial<PipelineNode>) => void;
  moveEditorNode: (nodeId: string, position: { x: number; y: number }) => void;
  addEditorConnection: (connection: PipelineConnection) => void;
  removeEditorConnection: (connectionId: string) => void;
  setEditorPipelineName: (name: string) => void;
  loadPipelineIntoEditor: (pipeline: PipelineDefinition) => void;

  // Actions — UI
  setActiveView: (view: ViewType) => void;
  selectNode: (nodeId: string | null) => void;
  setConfigPanelOpen: (open: boolean) => void;
  setConnected: (connected: boolean) => void;

  // Actions — Mesh
  addMeshEvent: (event: MeshEvent) => void;

  // Actions — Execution sim
  startSimulation: () => void;
  tickSimulation: () => void;

  // Actions — Terminal
  appendTerminalLine: (nodeId: string, type: string, text: string) => void;
  setActiveTerminalTab: (nodeId: string | null) => void;
}

// ============================================
// STORE
// ============================================

export const useCortivexStore = create<CortivexState>((set, get) => ({
  // Initial state — empty until fetchInitialData loads real data
  pipelines: [],
  activePipeline: null,
  activeRun: null,

  meshClaims: [],
  meshConflicts: [],
  meshEvents: [],

  insights: [],
  history: [],
  suggestions: [],

  activeView: 'mesh',
  selectedNode: null,
  isConfigPanelOpen: false,
  isConnected: false,
  isSidebarExpanded: false,
  isLoading: true,

  editorNodes: [],
  editorConnections: [],
  editorPipelineName: '',

  executionSimulation: null,
  terminalOutput: [],
  activeTerminalTab: null,

  // ============================================
  // DATA LOADING
  // ============================================

  fetchInitialData: async () => {
    // Guard against duplicate calls (React strict mode double-mount)
    if (!get().isLoading) return;

    // Quick connectivity check — one small request to avoid 5 parallel failures
    let serverOnline = false;
    try {
      const res = await fetch('/api/pipelines', { signal: AbortSignal.timeout(2000) });
      if (res.ok) serverOnline = true;
    } catch {
      // Server offline — skip all API calls
    }

    let pipelines, meshClaims, meshConflicts, insights, history;

    if (serverOnline) {
      // Fetch all endpoints in parallel
      [pipelines, meshClaims, meshConflicts, insights, history] =
        await Promise.all([
          apiFetchPipelines().catch(() => demoPipelines),
          apiFetchMeshClaims().catch(() => demoMeshClaims),
          apiFetchMeshConflicts().catch(() => demoMeshConflicts),
          apiFetchInsights().catch(() => demoInsights),
          apiFetchHistory().catch(() => demoHistory),
        ]);
    } else {
      console.warn('[Cortivex] HTTP server offline — using demo data');
      pipelines = demoPipelines;
      meshClaims = demoMeshClaims;
      meshConflicts = demoMeshConflicts;
      insights = demoInsights;
      history = demoHistory;
    }

    // If no mesh events came from API, use demo events as seed
    const meshEvents = demoMeshEvents;
    const suggestions = demoSuggestions;

    const activePipeline = pipelines.length > 0 ? pipelines[0] : null;

    set({
      pipelines,
      activePipeline,
      meshClaims,
      meshConflicts,
      meshEvents,
      insights,
      history,
      suggestions,
      editorNodes: activePipeline ? activePipeline.nodes : [],
      editorConnections: activePipeline ? activePipeline.connections : [],
      editorPipelineName: activePipeline ? activePipeline.name : '',
      isLoading: false,
    });
  },

  // ============================================
  // PIPELINE ACTIONS
  // ============================================

  loadPipelines: () => {
    set({ pipelines: demoPipelines });
  },

  setActivePipeline: (pipeline) => {
    set({ activePipeline: pipeline });
    if (pipeline) {
      set({
        editorNodes: pipeline.nodes,
        editorConnections: pipeline.connections,
        editorPipelineName: pipeline.name,
      });
    }
  },

  runPipeline: (_name: string) => {
    const { activePipeline, editorNodes, editorConnections } = get();
    if (!activePipeline) return;

    const run: PipelineRun = {
      id: `run-${Date.now()}`,
      pipelineName: activePipeline.name,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      nodes: editorNodes.map((n) => ({ ...n, status: 'pending' as NodeStatus, progress: 0, output: '', duration: 0, cost: 0, tokensUsed: 0, filesModified: [] })),
      connections: editorConnections,
      totalCost: 0,
      totalDuration: 0,
      totalTokens: 0,
      currentNodeId: null,
    };

    set({
      activeRun: run,
      activeView: 'execution',
      terminalOutput: [],
      activeTerminalTab: null,
    });

    // Try real API first, fallback to simulation
    fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline: activePipeline.name }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('API unavailable');
        return res.json();
      })
      .then((data) => {
        // Real execution started — events will come via WebSocket
        console.log('[Cortivex] Real pipeline started:', data.runId);
        get().appendTerminalLine(
          editorNodes[0]?.id || 'system',
          'system',
          `--- Real pipeline started (${data.runId}) ---`,
        );
      })
      .catch(() => {
        // API unavailable — use demo simulation
        console.log('[Cortivex] API offline, using simulation');
        get().startSimulation();
      });
  },

  updateActiveRun: (updates) => {
    set((state) => ({
      activeRun: state.activeRun ? { ...state.activeRun, ...updates } : null,
    }));
  },

  stopExecution: () => {
    const { executionSimulation } = get();
    if (executionSimulation) {
      executionSimulation.stop();
    }
    set({ executionSimulation: null });
  },

  // ============================================
  // EDITOR ACTIONS
  // ============================================

  addEditorNode: (node) => {
    set((state) => ({
      editorNodes: [...state.editorNodes, node],
    }));
  },

  removeEditorNode: (nodeId) => {
    set((state) => ({
      editorNodes: state.editorNodes.filter((n) => n.id !== nodeId),
      editorConnections: state.editorConnections.filter(
        (c) => c.sourceId !== nodeId && c.targetId !== nodeId,
      ),
      selectedNode: state.selectedNode === nodeId ? null : state.selectedNode,
    }));
  },

  updateEditorNode: (nodeId, updates) => {
    set((state) => ({
      editorNodes: state.editorNodes.map((n) =>
        n.id === nodeId ? { ...n, ...updates } : n,
      ),
    }));
  },

  moveEditorNode: (nodeId, position) => {
    set((state) => ({
      editorNodes: state.editorNodes.map((n) =>
        n.id === nodeId ? { ...n, position } : n,
      ),
    }));
  },

  addEditorConnection: (connection) => {
    set((state) => ({
      editorConnections: [...state.editorConnections, connection],
    }));
  },

  removeEditorConnection: (connectionId) => {
    set((state) => ({
      editorConnections: state.editorConnections.filter(
        (c) => c.id !== connectionId,
      ),
    }));
  },

  setEditorPipelineName: (name) => {
    set({ editorPipelineName: name });
  },

  loadPipelineIntoEditor: (pipeline) => {
    set({
      activePipeline: pipeline,
      editorNodes: pipeline.nodes.map((n) => ({ ...n })),
      editorConnections: pipeline.connections.map((c) => ({ ...c })),
      editorPipelineName: pipeline.name,
      selectedNode: null,
      isConfigPanelOpen: false,
    });
  },

  // ============================================
  // UI ACTIONS
  // ============================================

  setActiveView: (view) => {
    set({ activeView: view, selectedNode: null, isConfigPanelOpen: false });
  },

  selectNode: (nodeId) => {
    set({
      selectedNode: nodeId,
      isConfigPanelOpen: nodeId !== null,
    });
  },

  setConfigPanelOpen: (open) => {
    set({ isConfigPanelOpen: open });
    if (!open) {
      set({ selectedNode: null });
    }
  },

  setConnected: (connected) => {
    set({ isConnected: connected });
  },

  // ============================================
  // MESH ACTIONS
  // ============================================

  addMeshEvent: (event) => {
    set((state) => ({
      meshEvents: [event, ...state.meshEvents].slice(0, 100),
    }));
  },

  // ============================================
  // EXECUTION SIMULATION
  // ============================================

  startSimulation: () => {
    const { activeRun, stopExecution } = get();
    if (!activeRun) return;

    stopExecution();

    const sim = createLiveExecution(activeRun.nodes, {
      onNodeStart: (nodeId) => {
        set((state) => {
          if (!state.activeRun) return state;
          const nodes = state.activeRun.nodes.map((n) =>
            n.id === nodeId ? { ...n, status: 'running' as NodeStatus, progress: 0 } : n,
          );
          return {
            activeRun: { ...state.activeRun, nodes, currentNodeId: nodeId },
            activeTerminalTab: state.activeTerminalTab || nodeId,
          };
        });
        get().appendTerminalLine(nodeId, 'system', `--- Starting ${nodeId} ---`);
      },
      onNodeProgress: (nodeId, progress, line) => {
        set((state) => {
          if (!state.activeRun) return state;
          const nodes = state.activeRun.nodes.map((n) =>
            n.id === nodeId ? { ...n, progress } : n,
          );
          return { activeRun: { ...state.activeRun, nodes } };
        });
        if (line) {
          get().appendTerminalLine(nodeId, line.type, line.text);
        }
      },
      onNodeComplete: (nodeId, result) => {
        set((state) => {
          if (!state.activeRun) return state;
          const nodes = state.activeRun.nodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  status: 'completed' as NodeStatus,
                  progress: 100,
                  duration: result.duration,
                  cost: result.cost,
                  tokensUsed: result.tokens,
                  filesModified: result.filesModified || [],
                }
              : n,
          );
          const totalCost = nodes.reduce((s, n) => s + n.cost, 0);
          const totalTokens = nodes.reduce((s, n) => s + n.tokensUsed, 0);
          return {
            activeRun: { ...state.activeRun, nodes, totalCost, totalTokens },
          };
        });
        get().appendTerminalLine(
          nodeId,
          'system',
          `--- Completed (${result.duration.toFixed(1)}s, $${result.cost.toFixed(4)}) ---`,
        );
      },
      onPipelineComplete: () => {
        set((state) => {
          if (!state.activeRun) return state;
          const totalDuration =
            (Date.now() - new Date(state.activeRun.startedAt).getTime()) / 1000;
          return {
            activeRun: {
              ...state.activeRun,
              status: 'completed',
              completedAt: new Date().toISOString(),
              totalDuration,
              currentNodeId: null,
            },
            executionSimulation: null,
          };
        });
      },
    });

    set({ executionSimulation: sim });
    sim.start();
  },

  tickSimulation: () => {
    const { executionSimulation } = get();
    if (executionSimulation) {
      executionSimulation.tick();
    }
  },

  // ============================================
  // TERMINAL ACTIONS
  // ============================================

  appendTerminalLine: (nodeId, type, text) => {
    set((state) => {
      const existing = state.terminalOutput.find((t) => t.nodeId === nodeId);
      if (existing) {
        return {
          terminalOutput: state.terminalOutput.map((t) =>
            t.nodeId === nodeId
              ? { ...t, lines: [...t.lines, { type, text }] }
              : t,
          ),
        };
      }
      return {
        terminalOutput: [
          ...state.terminalOutput,
          { nodeId, lines: [{ type, text }] },
        ],
      };
    });
  },

  setActiveTerminalTab: (nodeId) => {
    set({ activeTerminalTab: nodeId });
  },
}));
