/**
 * SwarmSimulator — Broadcasts simulated swarm consensus events
 * over WebSocket for dashboard visualization and testing.
 *
 * This is a visualization aid, not a production consensus implementation.
 * Events: leader_elected, vote_cast, heartbeat, agent_died,
 * agent_respawned, task_rebalanced, knowledge_synced, quorum_check
 */

import { broadcast } from '../ws/handler.js';

interface SwarmAgent {
  id: string;
  name: string;
  role: 'leader' | 'follower' | 'candidate' | 'dead';
  tokensUsed: number;
  lastHeartbeat: number;
  taskCount: number;
}

export class SwarmSimulator {
  private agents: Map<string, SwarmAgent> = new Map();
  private term = 0;
  private leaderId: string | null = null;
  private running = false;
  private intervals: ReturnType<typeof setInterval>[] = [];

  start(agentCount = 5): void {
    if (this.running) return;
    this.running = true;
    this.term = 1;

    // Bootstrap agents
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
    for (let i = 0; i < agentCount; i++) {
      const id = `agent-${names[i]?.toLowerCase() || i}`;
      this.agents.set(id, {
        id,
        name: names[i] || `Agent-${i}`,
        role: 'follower',
        tokensUsed: 0,
        lastHeartbeat: Date.now(),
        taskCount: 0,
      });
    }

    // Broadcast cluster bootstrap
    broadcast('swarm:bootstrap', {
      agentCount,
      agents: Array.from(this.agents.values()).map(a => ({ id: a.id, name: a.name, role: a.role })),
    });

    // Run initial election after 2 seconds
    setTimeout(() => this.runElection(), 2000);

    // Heartbeat every 5 seconds
    this.intervals.push(setInterval(() => this.sendHeartbeats(), 5000));

    // Random events every 8-15 seconds
    this.intervals.push(setInterval(() => this.randomEvent(), 8000 + Math.random() * 7000));

    // Token accumulation every 3 seconds
    this.intervals.push(setInterval(() => this.accumulateTokens(), 3000));

    // Occasional agent death (every 30-60 seconds)
    this.intervals.push(setInterval(() => {
      if (Math.random() < 0.3) this.killRandomAgent();
    }, 30000 + Math.random() * 30000));
  }

  stop(): void {
    this.running = false;
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
    this.agents.clear();
    this.leaderId = null;

    broadcast('swarm:shutdown', { term: this.term });
  }

  private runElection(): void {
    if (!this.running) return;

    this.term++;
    const aliveAgents = Array.from(this.agents.values()).filter(a => a.role !== 'dead');
    if (aliveAgents.length === 0) return;

    // Pick a candidate (random alive agent)
    const candidateIdx = Math.floor(Math.random() * aliveAgents.length);
    const candidate = aliveAgents[candidateIdx];
    candidate.role = 'candidate';

    broadcast('swarm:election_started', {
      term: this.term,
      candidateId: candidate.id,
      candidateName: candidate.name,
    });

    // Simulate votes (all alive agents vote)
    let votesFor = 0;
    const totalVoters = aliveAgents.length;

    setTimeout(() => {
      for (const agent of aliveAgents) {
        const voteGranted = agent.id === candidate.id || Math.random() > 0.2;
        if (voteGranted) votesFor++;

        broadcast('swarm:vote_cast', {
          term: this.term,
          voterId: agent.id,
          voterName: agent.name,
          candidateId: candidate.id,
          granted: voteGranted,
          votesFor,
          votesNeeded: Math.floor(totalVoters / 2) + 1,
        });
      }

      // Check quorum
      const quorumNeeded = Math.floor(totalVoters / 2) + 1;
      const elected = votesFor >= quorumNeeded;

      setTimeout(() => {
        if (elected) {
          // Demote old leader
          if (this.leaderId && this.agents.has(this.leaderId)) {
            const oldLeader = this.agents.get(this.leaderId)!;
            if (oldLeader.role !== 'dead') oldLeader.role = 'follower';
          }

          // Promote new leader
          candidate.role = 'leader';
          this.leaderId = candidate.id;

          // All others become followers
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
            totalAgents: totalVoters,
          });
        } else {
          candidate.role = 'follower';
          broadcast('swarm:election_failed', {
            term: this.term,
            candidateId: candidate.id,
            votes: votesFor,
            quorum: quorumNeeded,
          });

          // Retry election after delay
          setTimeout(() => this.runElection(), 3000);
        }
      }, 1000);
    }, 1500);
  }

  private sendHeartbeats(): void {
    if (!this.running) return;

    for (const agent of this.agents.values()) {
      if (agent.role === 'dead') continue;
      agent.lastHeartbeat = Date.now();

      broadcast('swarm:heartbeat', {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        tokensUsed: agent.tokensUsed,
        taskCount: agent.taskCount,
        term: this.term,
      });
    }
  }

  private accumulateTokens(): void {
    if (!this.running) return;

    for (const agent of this.agents.values()) {
      if (agent.role === 'dead') continue;
      agent.tokensUsed += Math.floor(Math.random() * 2000) + 500;
      agent.taskCount = Math.floor(agent.tokensUsed / 10000);
    }
  }

  private killRandomAgent(): void {
    if (!this.running) return;

    const aliveAgents = Array.from(this.agents.values()).filter(a => a.role !== 'dead');
    if (aliveAgents.length <= 2) return; // Keep at least 2 alive

    const victim = aliveAgents[Math.floor(Math.random() * aliveAgents.length)];
    const wasLeader = victim.role === 'leader';
    victim.role = 'dead';

    broadcast('swarm:agent_died', {
      agentId: victim.id,
      agentName: victim.name,
      wasLeader,
      reason: Math.random() > 0.5 ? 'heartbeat_timeout_90s' : 'token_limit_exceeded_80K',
      term: this.term,
    });

    // Auto-respawn after 3 seconds
    setTimeout(() => {
      if (!this.running) return;

      const newId = `${victim.id}-respawn`;
      const newAgent: SwarmAgent = {
        id: newId,
        name: `${victim.name}-2`,
        role: 'follower',
        tokensUsed: 0,
        lastHeartbeat: Date.now(),
        taskCount: 0,
      };

      this.agents.delete(victim.id);
      this.agents.set(newId, newAgent);

      broadcast('swarm:agent_respawned', {
        oldAgentId: victim.id,
        newAgentId: newId,
        newAgentName: newAgent.name,
        term: this.term,
      });

      // Rebalance tasks
      broadcast('swarm:task_rebalanced', {
        fromAgent: victim.id,
        toAgent: newId,
        taskCount: victim.taskCount,
        term: this.term,
      });

      // If leader died, trigger new election
      if (wasLeader) {
        this.leaderId = null;
        setTimeout(() => this.runElection(), 2000);
      }
    }, 3000);
  }

  private randomEvent(): void {
    if (!this.running) return;

    const events = ['knowledge_sync', 'quorum_check', 'mesh_claim', 'conflict_resolved'];
    const event = events[Math.floor(Math.random() * events.length)];

    const aliveAgents = Array.from(this.agents.values()).filter(a => a.role !== 'dead');
    if (aliveAgents.length === 0) return;

    const agent = aliveAgents[Math.floor(Math.random() * aliveAgents.length)];

    switch (event) {
      case 'knowledge_sync':
        broadcast('swarm:knowledge_synced', {
          agentId: agent.id,
          agentName: agent.name,
          findingsCount: Math.floor(Math.random() * 5) + 1,
          deduplicatedCount: Math.floor(Math.random() * 3),
          term: this.term,
        });
        break;

      case 'quorum_check': {
        const alive = aliveAgents.length;
        const total = this.agents.size;
        broadcast('swarm:quorum_check', {
          alive,
          total,
          quorumMet: alive > total / 2,
          term: this.term,
        });
        break;
      }

      case 'mesh_claim': {
        const files = ['src/auth/session.ts', 'src/api/routes.ts', 'src/utils/helpers.ts', 'src/config/database.ts'];
        broadcast('swarm:mesh_claim', {
          agentId: agent.id,
          agentName: agent.name,
          file: files[Math.floor(Math.random() * files.length)],
          term: this.term,
        });
        break;
      }

      case 'conflict_resolved': {
        const strategies = ['priority_based', 'first_claim', 'leader_arbitration'];
        broadcast('swarm:conflict_resolved', {
          file: 'src/auth/session.ts',
          strategy: strategies[Math.floor(Math.random() * strategies.length)],
          winnerId: agent.id,
          winnerName: agent.name,
          term: this.term,
        });
        break;
      }
    }
  }
}

export const swarmSimulator = new SwarmSimulator();
