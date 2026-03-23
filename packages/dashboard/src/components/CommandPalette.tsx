import { useEffect, useState, useCallback } from 'react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandEmpty,
  CommandShortcut,
} from '@/components/ui/command';
import {
  Workflow,
  Play,
  Network,
  GitBranch,
  Clock,
  BarChart3,
  Search,
  Settings,
  Zap,
} from 'lucide-react';
import { useCortivexStore } from '@/stores/cortivexStore';
import { nodeTypeCatalog } from '@/lib/demo-data';
import type { ViewType } from '@/lib/types';

const viewCommands: { id: ViewType; label: string; icon: typeof Workflow }[] = [
  { id: 'editor', label: 'Pipeline Editor', icon: Workflow },
  { id: 'execution', label: 'Live Execution', icon: Play },
  { id: 'mesh', label: 'Mesh Visualization', icon: Network },
  { id: 'knowledge', label: 'Knowledge Graph', icon: GitBranch },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'learning', label: 'Analytics', icon: BarChart3 },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { setActiveView, pipelines: rawPipelines, loadPipelineIntoEditor, runPipeline } = useCortivexStore();
  const pipelines = Array.isArray(rawPipelines) ? rawPipelines : [];

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleViewSelect = useCallback(
    (viewId: ViewType) => {
      setActiveView(viewId);
      setOpen(false);
    },
    [setActiveView],
  );

  const handlePipelineSelect = useCallback(
    (pipelineName: string) => {
      const pipeline = pipelines.find((p) => p.name === pipelineName);
      if (pipeline) {
        loadPipelineIntoEditor(pipeline);
        setActiveView('editor');
      }
      setOpen(false);
    },
    [pipelines, loadPipelineIntoEditor, setActiveView],
  );

  const handleRunPipeline = useCallback(
    (pipelineName: string) => {
      runPipeline(pipelineName);
      setOpen(false);
    },
    [runPipeline],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pipelines, views, nodes..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Views">
          {viewCommands.map((view) => {
            const Icon = view.icon;
            return (
              <CommandItem
                key={view.id}
                value={view.label}
                onSelect={() => handleViewSelect(view.id)}
              >
                <Icon className="mr-2 h-4 w-4 text-text-muted" />
                <span>{view.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Pipelines">
          {pipelines.map((pipeline) => (
            <CommandItem
              key={pipeline.name}
              value={pipeline.name}
              onSelect={() => handlePipelineSelect(pipeline.name)}
            >
              <Workflow className="mr-2 h-4 w-4 text-cortivex-cyan" />
              <span>{pipeline.name}</span>
              <CommandShortcut>{pipeline.nodes.length} nodes</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="run pipeline"
            onSelect={() => {
              const store = useCortivexStore.getState();
              if (store.activePipeline) {
                handleRunPipeline(store.activePipeline.name);
              }
            }}
          >
            <Zap className="mr-2 h-4 w-4 text-warning-amber" />
            <span>Run Current Pipeline</span>
            <CommandShortcut>Ctrl+Enter</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="search nodes"
            onSelect={() => {
              setActiveView('editor');
              setOpen(false);
            }}
          >
            <Search className="mr-2 h-4 w-4 text-text-muted" />
            <span>Search Nodes</span>
          </CommandItem>
          <CommandItem
            value="settings"
            onSelect={() => setOpen(false)}
          >
            <Settings className="mr-2 h-4 w-4 text-text-muted" />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Node Types">
          {nodeTypeCatalog.slice(0, 10).map((node) => (
            <CommandItem key={node.id} value={node.name}>
              <div
                className="mr-2 h-3 w-3 rounded-full"
                style={{ backgroundColor: node.category === 'quality' ? '#4F8EF7' : node.category === 'security' ? '#E05C5C' : node.category === 'testing' ? '#3DD68C' : '#E8A44A' }}
              />
              <span>{node.name}</span>
              <CommandShortcut>${node.avgCost.toFixed(2)}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
