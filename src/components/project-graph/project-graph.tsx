import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useMemo, useState, type CSSProperties } from "react";

import type {
  GraphNodeKind,
  ProjectGraphEdge,
  ProjectGraphNode,
} from "@/lib/graph/types";
import styles from "./project-graph.module.css";

type FlowNodeData = Record<string, unknown> & {
  label: string;
  kind: GraphNodeKind;
  title: string;
  description: string;
};

type ProjectGraphProps = {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
};

const nodeStyles: Record<GraphNodeKind, CSSProperties> = {
  project: {
    background: "#19352e",
    border: "1px solid #4cc9a6",
    color: "#f4f4f5",
    width: 124,
  },
  chat: {
    background: "#1d2838",
    border: "1px solid #79a7df",
    color: "#f4f4f5",
    width: 128,
  },
  message_summary: {
    background: "#332c1b",
    border: "1px solid #d4aa55",
    color: "#f4f4f5",
    width: 142,
  },
  file: {
    background: "#2f2430",
    border: "1px solid #d48fd1",
    color: "#f4f4f5",
    width: 138,
  },
  topic: {
    background: "#263524",
    border: "1px solid #9ad17b",
    color: "#f4f4f5",
    width: 128,
  },
  provider: {
    background: "#35302b",
    border: "1px solid #d08c5a",
    color: "#f4f4f5",
    width: 124,
  },
};

const minimapColors: Record<GraphNodeKind, string> = {
  project: "#4cc9a6",
  chat: "#79a7df",
  message_summary: "#d4aa55",
  file: "#d48fd1",
  topic: "#9ad17b",
  provider: "#d08c5a",
};

export function ProjectGraph({ nodes, edges }: ProjectGraphProps) {
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id ?? "");

  const flowNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        position: node.position,
        selected: node.id === selectedNodeId,
        data: {
          label: node.title,
          kind: node.type,
          title: node.title,
          description: node.description,
        },
        style: nodeStyles[node.type],
      })),
    [nodes, selectedNodeId],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        label: edge.label,
        animated: edge.weight >= 0.9,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#5d6370",
        },
      })),
    [edges],
  );

  return (
    <div className={styles.shell}>
      <div className={styles.canvas}>
        <ReactFlow
          className={styles.flow}
          nodes={flowNodes}
          edges={flowEdges}
          fitView
          fitViewOptions={{ padding: 0.28 }}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId("")}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#30323b" gap={18} size={1} />
          <MiniMap
            maskColor="rgba(16, 17, 20, 0.68)"
            nodeColor={(node) => {
              const kind = node.data.kind as GraphNodeKind | undefined;
              return node.selected || !kind ? "#4cc9a6" : minimapColors[kind];
            }}
            pannable
            zoomable
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
