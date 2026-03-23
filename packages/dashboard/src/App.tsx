import React, { useCallback, useEffect } from 'react';

// Error boundary to prevent component crashes from killing the whole app
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from '@/components/Sidebar';
import { StatusBar } from '@/components/StatusBar';
import { CommandPalette } from '@/components/CommandPalette';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PipelineEditorView } from '@/views/PipelineEditorView';
import { LiveExecutionView } from '@/views/LiveExecutionView';
import { LearningView } from '@/views/LearningView';
import { MeshView } from '@/views/MeshView';
import { KnowledgeGraphView } from '@/views/KnowledgeGraphView';
import { TimelineView } from '@/views/TimelineView';
import { useCortivexStore } from '@/stores/cortivexStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { WSEvent, NodeStatus } from '@/lib/types';

const viewComponents = {
  editor: PipelineEditorView,
  execution: LiveExecutionView,
  learning: LearningView,
  mesh: MeshView,
  knowledge: KnowledgeGraphView,
  timeline: TimelineView,
  metrics: LearningView, // merged into unified analytics
};

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: 'easeInOut' },
};

export default function App() {
  const { activeView, setConnected, isLoading, fetchInitialData } = useCortivexStore();

  const handleWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === 'connected') {
        setConnected(true);
      }

      const store = useCortivexStore.getState();

      // Handle real pipeline execution events from the server
      const d = event.data || {};

      if (event.type === 'node:start' && store.activeRun) {
        const nodeId = d.nodeId as string;
        if (nodeId) {
          store.appendTerminalLine(nodeId, 'system', `--- Starting ${nodeId} ---`);
          const nodes = store.activeRun.nodes.map((n) =>
            n.id === nodeId ? { ...n, status: 'running' as NodeStatus, progress: 0 } : n,
          );
          store.updateActiveRun({ nodes, currentNodeId: nodeId });
          if (!store.activeTerminalTab) store.setActiveTerminalTab(nodeId);
        }
      }

      if (event.type === 'node:progress' && store.activeRun) {
        const nodeId = d.nodeId as string;
        const progress = d.progress as number;
        const line = d.line as { type: string; text: string } | undefined;
        if (nodeId) {
          const nodes = store.activeRun.nodes.map((n) =>
            n.id === nodeId ? { ...n, progress: progress || n.progress } : n,
          );
          store.updateActiveRun({ nodes });
          if (line) store.appendTerminalLine(nodeId, line.type, line.text);
        }
      }

      if (event.type === 'node:complete' && store.activeRun) {
        const nodeId = d.nodeId as string;
        if (nodeId) {
          const nodes = store.activeRun.nodes.map((n) =>
            n.id === nodeId ? { ...n, status: 'completed' as NodeStatus, progress: 100, duration: (d.duration as number) || 0, cost: (d.cost as number) || 0, tokensUsed: (d.tokens as number) || 0, filesModified: (d.filesModified as string[]) || [] } : n,
          );
          const totalCost = nodes.reduce((s, n) => s + n.cost, 0);
          const totalTokens = nodes.reduce((s, n) => s + n.tokensUsed, 0);
          store.updateActiveRun({ nodes, totalCost, totalTokens });
          store.appendTerminalLine(nodeId, 'system', `--- Completed ---`);
        }
      }

      if (event.type === 'node:failed' && store.activeRun) {
        const nodeId = d.nodeId as string;
        if (nodeId) {
          const nodes = store.activeRun.nodes.map((n) =>
            n.id === nodeId ? { ...n, status: 'failed' as NodeStatus } : n,
          );
          store.updateActiveRun({ nodes });
          store.appendTerminalLine(nodeId, 'error', `--- Failed: ${d.error || 'unknown'} ---`);
        }
      }

      if (event.type === 'pipeline:complete' && store.activeRun) {
        const totalDuration = (Date.now() - new Date(store.activeRun.startedAt).getTime()) / 1000;
        store.updateActiveRun({
          status: 'completed',
          completedAt: new Date().toISOString(),
          totalDuration,
          currentNodeId: null,
        });
      }

      // Handle live SWARM consensus events — feed into mesh events
      if (event.type.startsWith('swarm:')) {
        const swarmType = event.type.replace('swarm:', '').toUpperCase();
        const desc = formatSwarmEvent(event.type, d);
        if (desc) {
          store.addMeshEvent({
            id: `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: swarmType,
            agentId: (d.agentId as string) || (d.leaderId as string) || 'system',
            agentName: (d.agentName as string) || (d.leaderName as string) || 'SwarmSimulator',
            details: desc,
            timestamp: event.timestamp || new Date().toISOString(),
            file: (d.file as string) || undefined,
          });
        }
      }
    },
    [setConnected],
  );

  function formatSwarmEvent(type: string, d: Record<string, unknown>): string {
    switch (type) {
      case 'swarm:bootstrap':
        return `Cluster bootstrapped with ${d.agentCount} agents`;
      case 'swarm:election_started':
        return `Election started (term ${d.term}) -- ${d.candidateName} is candidate`;
      case 'swarm:vote_cast':
        return `${d.voterName} voted ${d.granted ? 'YES' : 'NO'} for ${d.candidateId} (${d.votesFor}/${d.votesNeeded})`;
      case 'swarm:leader_elected':
        return `${d.leaderName} elected LEADER (term ${d.term}, ${d.votes}/${d.quorum} quorum)`;
      case 'swarm:election_failed':
        return `Election failed (term ${d.term}) -- ${d.votes}/${d.quorum} votes, retrying`;
      case 'swarm:heartbeat':
        return `Heartbeat from ${d.agentName} [${d.role}] -- ${d.tokensUsed} tokens`;
      case 'swarm:agent_died':
        return `${d.agentName} DIED (${d.reason})${d.wasLeader ? ' -- was LEADER' : ''}`;
      case 'swarm:agent_respawned':
        return `${d.newAgentName} respawned (replacing ${d.oldAgentId})`;
      case 'swarm:task_rebalanced':
        return `${d.taskCount} tasks rebalanced from ${d.fromAgent} to ${d.toAgent}`;
      case 'swarm:knowledge_synced':
        return `${d.agentName} synced ${d.findingsCount} findings (${d.deduplicatedCount} deduplicated)`;
      case 'swarm:quorum_check':
        return `Quorum check: ${d.alive}/${d.total} alive -- ${d.quorumMet ? 'QUORUM MET' : 'QUORUM LOST'}`;
      case 'swarm:conflict_resolved':
        return `Conflict on ${d.file} resolved via ${d.strategy} (${d.winnerName} wins)`;
      case 'swarm:shutdown':
        return `Cluster shutdown (term ${d.term})`;
      default:
        return '';
    }
  }

  // Connect to WebSocket (will auto-reconnect)
  const { isConnected } = useWebSocket({
    onEvent: handleWSEvent,
    enabled: true,
  });

  // Sync connection state from hook to store
  useEffect(() => {
    setConnected(isConnected);
  }, [isConnected, setConnected]);

  // Fetch real data from API on mount
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const ActiveView = viewComponents[activeView];

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black/90">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-cyan-400/80 font-mono tracking-wide">
            Loading Cortivex data...
          </span>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-screen w-screen flex flex-col overflow-hidden relative">
        {/* Animated mesh background */}
        <div className="mesh-background" />
        <div className="mesh-grid" />

        {/* Main layout */}
        <div className="relative z-10 flex flex-col h-full">
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            <Sidebar />

            {/* Main Content */}
            <main className="flex-1 overflow-hidden relative">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeView}
                  className="h-full"
                  {...pageTransition}
                >
                  <ActiveView />
                </motion.div>
              </AnimatePresence>
            </main>
          </div>

          {/* Status Bar */}
          <StatusBar />
        </div>

        {/* Command Palette (Cmd+K) — wrapped to prevent crash from taking down the app */}
        <ErrorBoundary>
          <CommandPalette />
        </ErrorBoundary>

        {/* Toast notifications */}
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
