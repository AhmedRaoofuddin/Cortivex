/**
 * SwarmSimulator — Broadcasts real pipeline node events as swarm consensus
 * events over WebSocket for dashboard visualization.
 *
 * When a pipeline runs, actual nodes (Code Reviewer, Security Scanner, etc.)
 * are treated as swarm agents. Leader election picks the first active node
 * as coordinator. Heartbeats reflect real token accumulation from Claude CLI.
 *
 * Events: bootstrap, election_started, vote_cast, leader_elected,
 * heartbeat, agent_died, agent_respawned, task_rebalanced,
 * knowledge_synced, quorum_check, conflict_resolved, shutdown
 */

import { broadcast } from '../ws/handler.js';

interface SwarmAgent {
  id: string;
  name: string;
  role: 'leader' | 'follower' | 'candidate' | 'dead';
  tokensUsed: number;
  cost: number;
  lastHeartbeat: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
}

export class SwarmSimulator {
  private agents: Map<string, SwarmAgent> = new Map();
  private term = 0;
  private leaderId: string | null = null;
  private running = false;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private quorumInterval: ReturnType<typeof setInterval> | null = null;
  private electionInProgress = false;

  /**
   * Start the swarm with real pipeline node names.
   * @param nodeNames Array of actual pipeline node IDs/names
   */
  start(nodeNames: string[]): void {
    if (this.running) return;
    this.running = true;
    this.term = 0;
    this.agents.clear();
    this.leaderId = null;

    // Create agents from real pipeline nodes
    for (const name of nodeNames) {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      this.agents.set(id, {
        id,
        name,
        role: 'follower',
        tokensUsed: 0,
        cost: 0,
        lastHeartbeat: Date.now(),
        status: 'pending',
        progress: 0,
      });
    }

    // Broadcast cluster bootstrap with real node names
    broadcast('swarm:bootstrap', {
      agentCount: nodeNames.length,
      agents: Array.from(this.agents.values()).map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
      })),
    });

    // Start heartbeat broadcasting every 4 seconds
    this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), 4000);

    // Quorum checks every 10 seconds
    this.quorumInterval = setInterval(() => this.checkQuorum(), 10000);
  }

  stop(): void {
    this.running = false;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.quorumInterval) clearInterval(this.quorumInterval);
    this.heartbeatInterval = null;
    this.quorumInterval = null;

    broadcast('swarm:shutdown', {
      term: this.term,
      totalAgents: this.agents.size,
      completedAgents: Array.from(this.agents.values()).filter(a => a.status === 'completed').length,
    });

    this.agents.clear();
    this.leaderId = null;
    this.electionInProgress = false;
  }

  /**
   * Called when a real pipeline node starts executing.
   * Triggers leader election if no leader exists.
   */
  onNodeStart(nodeId: string, nodeType: string): void {
    if (!this.running) return;

    // Find agent by matching nodeId or nodeType
    const agent = this.findAgent(nodeId, nodeType);
    if (!agent) return;

    agent.status = 'running';
    agent.lastHeartbeat = Date.now();

    // If no leader and no election in progress, run election with this node as candidate
    if (!this.leaderId && !this.electionInProgress) {
      this.runElection(agent.id);
    }

    broadcast('swarm:task_rebalanced', {
      agentId: agent.id,
      agentName: agent.name,
      action: 'started',
      nodeType,
      term: this.term,
    });
  }

  /**
   * Called when a real pipeline node reports progress.
   */
  onNodeProgress(nodeId: string, progress: number, message: string): void {
    if (!this.running) return;

    const agent = this.findAgent(nodeId);
    if (!agent) return;

    agent.progress = progress;
    agent.lastHeartbeat = Date.now();
  }

  /**
   * Called when a real pipeline node completes successfully.
   */
  onNodeComplete(nodeId: string, cost: number, tokens: number): void {
    if (!this.running) return;

    const agent = this.findAgent(nodeId);
    if (!agent) return;

    agent.status = 'completed';
    agent.tokensUsed = tokens;
    agent.cost = cost;
    agent.progress = 100;

    // Sync knowledge from this node's findings
    broadcast('swarm:knowledge_synced', {
      agentId: agent.id,
      agentName: agent.name,
      tokensUsed: tokens,
      cost,
      term: this.term,
    });

    // If the leader completed, elect a new leader from running nodes
    if (agent.id === this.leaderId) {
      const runningAgents = Array.from(this.agents.values()).filter(
        a => a.status === 'running' && a.id !== agent.id
      );
      if (runningAgents.length > 0) {
        this.leaderId = null;
        agent.role = 'follower';
        this.runElection(runningAgents[0].id);
      }
    }
  }

  /**
   * Called when a real pipeline node fails.
   */
  onNodeFailed(nodeId: string, error: string): void {
    if (!this.running) return;

    const agent = this.findAgent(nodeId);
    if (!agent) return;

    const wasLeader = agent.id === this.leaderId;
    agent.status = 'failed';
    agent.role = 'dead';

    broadcast('swarm:agent_died', {
      agentId: agent.id,
      agentName: agent.name,
      wasLeader,
      reason: error.slice(0, 100),
      term: this.term,
    });

    // If leader died, elect new one
    if (wasLeader) {
      this.leaderId = null;
      const runningAgents = Array.from(this.agents.values()).filter(
        a => a.status === 'running'
      );
      if (runningAgents.length > 0) {
        setTimeout(() => this.runElection(runningAgents[0].id), 1000);
      }
    }
  }

  /**
   * Called when mesh conflict is detected.
   */
  onMeshConflict(file: string, claimedBy: string): void {
    if (!this.running) return;

    broadcast('swarm:conflict_resolved', {
      file,
      claimedBy,
      strategy: 'first_claim',
      term: this.term,
    });
  }

  /**
   * Leader election using actual pipeline nodes.
   * The candidate is a real running node, votes are based on node readiness.
   */
  private runElection(candidateId?: string): void {
    if (!this.running || this.electionInProgress) return;
    this.electionInProgress = true;

    this.term++;
    const aliveAgents = Array.from(this.agents.values()).filter(
      a => a.role !== 'dead' && a.status !== 'failed'
    );
    if (aliveAgents.length === 0) return;

    // Pick candidate: specified or first running agent
    const candidate = candidateId
      ? this.agents.get(candidateId) ?? aliveAgents[0]
      : aliveAgents[0];

    if (!candidate) return;
    candidate.role = 'candidate';

    broadcast('swarm:election_started', {
      term: this.term,
      candidateId: candidate.id,
      candidateName: candidate.name,
    });

    // Voting: synchronous — no setTimeout delays that let heartbeats
    // overwrite the election state before it completes
    let votesFor = 0;
    const quorumNeeded = Math.floor(aliveAgents.length / 2) + 1;

    for (const agent of aliveAgents) {
      const granted = agent.role !== 'dead' && agent.status !== 'failed';
      if (granted) votesFor++;

      broadcast('swarm:vote_cast', {
        term: this.term,
        voterId: agent.id,
        voterName: agent.name,
        candidateId: candidate.id,
        granted,
        votesFor,
        votesNeeded: quorumNeeded,
      });
    }

    const elected = votesFor >= quorumNeeded;

    if (elected) {
      // Demote old leader
      if (this.leaderId && this.agents.has(this.leaderId)) {
        const old = this.agents.get(this.leaderId)!;
        if (old.role !== 'dead') old.role = 'follower';
      }

      candidate.role = 'leader';
      this.leaderId = candidate.id;
      this.electionInProgress = false;

      for (const agent of aliveAgents) {
        if (agent.id !== candidate.id && agent.role !== 'dead') {
          agent.role = 'follower';
        }
      }

      broadcast('swarm:leader_elected', {
        term: this.term,
        leaderId: candidate.id,
        leaderName: candidate.name,
        votes: votesFor,
        quorum: quorumNeeded,
        totalAgents: aliveAgents.length,
      });
    } else {
      candidate.role = 'follower';
      this.electionInProgress = false;
      broadcast('swarm:election_failed', {
        term: this.term,
        candidateId: candidate.id,
        votes: votesFor,
        quorum: quorumNeeded,
      });
    }
  }

  private sendHeartbeats(): void {
    if (!this.running) return;

    for (const agent of this.agents.values()) {
      if (agent.role === 'dead' || agent.status === 'failed') continue;

      broadcast('swarm:heartbeat', {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        status: agent.status,
        tokensUsed: agent.tokensUsed,
        cost: agent.cost,
        progress: agent.progress,
        term: this.term,
      });
    }
  }

  private checkQuorum(): void {
    if (!this.running) return;

    const alive = Array.from(this.agents.values()).filter(
      a => a.role !== 'dead' && a.status !== 'failed'
    ).length;
    const total = this.agents.size;

    broadcast('swarm:quorum_check', {
      alive,
      total,
      quorumMet: alive > total / 2,
      term: this.term,
    });
  }

  private findAgent(nodeId: string, nodeType?: string): SwarmAgent | undefined {
    // Try exact match on id
    const normalized = nodeId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let agent = this.agents.get(normalized);
    if (agent) return agent;

    // Try matching by name containing nodeId or nodeType
    for (const a of this.agents.values()) {
      const aName = a.name.toLowerCase();
      const aId = a.id.toLowerCase();
      if (
        aName === nodeId.toLowerCase() ||
        aId === nodeId.toLowerCase() ||
        (nodeType && aName === nodeType.toLowerCase()) ||
        (nodeType && aId === nodeType.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      ) {
        return a;
      }
    }

    // Partial match
    for (const a of this.agents.values()) {
      if (
        a.name.toLowerCase().includes(nodeId.toLowerCase()) ||
        a.id.includes(normalized)
      ) {
        return a;
      }
    }

    return undefined;
  }
}

export const swarmSimulator = new SwarmSimulator();
