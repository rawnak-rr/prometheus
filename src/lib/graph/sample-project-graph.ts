import type { ProjectGraphEdge, ProjectGraphNode } from "./types";

const projectId = "prometheus";

export const sampleProjectGraphNodes: ProjectGraphNode[] = [
  {
    id: "project-prometheus",
    projectId,
    type: "project",
    title: "Prometheus",
    description: "The active repository and workspace for project-aware AI memory.",
    metadata: [
      { label: "Scope", value: "MVP web app" },
      { label: "State", value: "Bootstrap" },
    ],
    contextPath: ".prometheus/graph/project-prometheus.md",
    contextMarkdown: `# Prometheus

## Purpose
Local workspace for project-aware AI context management and tool routing.

## Current Focus
- Make the graph an active context selector, not a decorative memory map.
- Keep durable project knowledge in small markdown notes.
- Route model turns through selected graph nodes, file targets, and tool policies.

## Context Contract
Use this node when the task affects the whole app direction or cross-cutting agent behavior.`,
    filePaths: ["package.json", "src/renderer/src/App.tsx"],
    toolIds: ["workspace.list_files", "git.status", "repo_map.find_symbols"],
    ruleIds: ["project-context", "local-agent-runtime"],
    position: { x: 0, y: 80 },
  },
  {
    id: "provider-codex",
    projectId,
    type: "provider",
    title: "Codex",
    description: "Local terminal coding agent available through the provider layer.",
    metadata: [
      { label: "Mode", value: "Local CLI" },
      { label: "Status", value: "Planned integration" },
    ],
    contextPath: ".prometheus/graph/provider-codex.md",
    contextMarkdown: `# Codex Provider

## Purpose
Represents the local coding agent runtime available through the provider layer.

## Context Targets
- Session startup and shutdown behavior.
- Tool approval routing.
- Workspace-write/read-only mode boundaries.

## Avoid
Do not load this node for purely visual graph work unless provider routing is involved.`,
    filePaths: [
      "src/lib/chat/codex-app-server-runner.ts",
      "src/lib/chat/types.ts",
    ],
    toolIds: ["git.diff", "npm.typecheck"],
    ruleIds: ["approval-flow"],
    position: { x: -260, y: -60 },
  },
  {
    id: "chat-bootstrap",
    projectId,
    type: "chat",
    title: "Bootstrap Chat",
    description: "Initial conversation that defined the Prometheus MVP and graph-first direction.",
    metadata: [
      { label: "Messages", value: "Seeded" },
      { label: "Provider", value: "Codex" },
    ],
    contextPath: ".prometheus/graph/chat-bootstrap.md",
    contextMarkdown: `# Bootstrap Chat

## Purpose
Archive pointer for the early project conversation.

## Use
Use this as provenance when a decision needs to be traced back to the initial product direction.

## Do Not
Do not inject full chat summaries by default. Extract durable decisions into feature, area, and constraint nodes instead.`,
    filePaths: ["src/lib/chat/types.ts"],
    toolIds: ["chat.list_sessions"],
    ruleIds: ["conversation-extraction"],
    position: { x: 280, y: -70 },
  },
  {
    id: "file-project-plan",
    projectId,
    type: "file",
    title: "PROJECT_PLAN.md",
    description: "Local planning document with goals, MVP scope, and implementation chunks.",
    metadata: [
      { label: "Git", value: "Ignored" },
      { label: "Role", value: "Living spec" },
    ],
    contextPath: ".prometheus/graph/file-project-plan.md",
    contextMarkdown: `# PROJECT_PLAN.md

## Purpose
Living planning document for goals, implementation chunks, and deferred decisions.

## Context Targets
- Product direction.
- MVP sequencing.
- Open implementation questions.

## Populate
Link this node to decisions and feature nodes instead of copying long planning text into every context pack.`,
    filePaths: ["PROJECT_PLAN.md"],
    toolIds: ["workspace.read_file"],
    ruleIds: ["planning-docs"],
    position: { x: 280, y: 190 },
  },
  {
    id: "topic-graph-v1",
    projectId,
    type: "topic",
    title: "Graph V1",
    description: "Obsidian-style nodes and typed edges for visual project context.",
    metadata: [
      { label: "Priority", value: "MVP" },
      { label: "Depth", value: "Visual first" },
    ],
    contextPath: ".prometheus/graph/topic-graph-v1.md",
    contextMarkdown: `# Graph V1

## Purpose
The graph is the context operating surface for local agents.

## Current Decisions
- Nodes use one restrained visual style.
- Clicking a node reveals markdown-backed context below the graph.
- Whole-chat compaction is archival, not the main context source.

## Next
Turn selected nodes into context pack previews that show files, rules, tools, and token cost before a model turn.`,
    filePaths: [
      "src/components/project-graph/project-graph.tsx",
      "src/components/project-graph/project-graph.module.css",
      "src/renderer/src/App.tsx",
      "src/renderer/src/App.module.css",
    ],
    toolIds: ["repo_map.find_references", "workspace.read_file", "npm.typecheck"],
    ruleIds: ["graph-context-pack"],
    position: { x: 590, y: 25 },
  },
  {
    id: "summary-mvp",
    projectId,
    type: "message_summary",
    title: "MVP Summary",
    description: "A compact summary of the early product direction and deferred AI graph work.",
    metadata: [
      { label: "Covers", value: "Scope and constraints" },
      { label: "Next", value: "Real graph data" },
    ],
    contextPath: ".prometheus/graph/summary-mvp.md",
    contextMarkdown: `# MVP Summary

## Purpose
Compact durable summary of the initial MVP direction.

## Extraction Rule
Summaries should produce reusable facts, decisions, constraints, and unresolved questions. They should not become another long transcript.

## Use
Load this node when bootstrapping a new task with broad product context.`,
    filePaths: ["src/lib/graph/sample-project-graph.ts"],
    toolIds: ["workspace.read_file"],
    ruleIds: ["summary-extraction"],
    position: { x: 600, y: 250 },
  },
];

export const sampleProjectGraphEdges: ProjectGraphEdge[] = [
  {
    id: "project-contains-chat",
    projectId,
    sourceNodeId: "project-prometheus",
    targetNodeId: "chat-bootstrap",
    type: "contains",
    weight: 1,
    label: "contains",
  },
  {
    id: "project-contains-plan",
    projectId,
    sourceNodeId: "project-prometheus",
    targetNodeId: "file-project-plan",
    type: "contains",
    weight: 1,
    label: "contains",
  },
  {
    id: "project-contains-topic",
    projectId,
    sourceNodeId: "project-prometheus",
    targetNodeId: "topic-graph-v1",
    type: "contains",
    weight: 1,
    label: "contains",
  },
  {
    id: "chat-used-provider",
    projectId,
    sourceNodeId: "chat-bootstrap",
    targetNodeId: "provider-codex",
    type: "used_provider",
    weight: 1,
    label: "used provider",
  },
  {
    id: "chat-mentions-plan",
    projectId,
    sourceNodeId: "chat-bootstrap",
    targetNodeId: "file-project-plan",
    type: "mentions",
    weight: 0.8,
    label: "mentions",
  },
  {
    id: "chat-mentions-graph",
    projectId,
    sourceNodeId: "chat-bootstrap",
    targetNodeId: "topic-graph-v1",
    type: "mentions",
    weight: 0.9,
    label: "mentions",
  },
  {
    id: "summary-summarizes-chat",
    projectId,
    sourceNodeId: "summary-mvp",
    targetNodeId: "chat-bootstrap",
    type: "summarizes",
    weight: 0.9,
    label: "summarizes",
  },
  {
    id: "graph-implemented-in-plan",
    projectId,
    sourceNodeId: "topic-graph-v1",
    targetNodeId: "file-project-plan",
    type: "implemented_in",
    weight: 0.7,
    label: "implemented in",
  },
];
