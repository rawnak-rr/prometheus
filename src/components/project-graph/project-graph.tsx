import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useMemo } from "react";

import type {
  ProjectGraphEdge,
  ProjectGraphNode,
} from "@/lib/graph/types";
import styles from "./project-graph.module.css";

type FlowNodeData = Record<string, unknown> & {
  label: string;
  title: string;
  description: string;
};

type ProjectGraphProps = {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  selectedNodeId: string | null;
  onSelectedNodeIdChange: (nodeId: string | null) => void;
};

const nodeStyle = {
  background: "#181a1f",
  border: "1px solid #343842",
  color: "#f4f4f5",
  width: 148,
};

export function ProjectGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectedNodeIdChange,
}: ProjectGraphProps) {
  const flowNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        position: node.position,
        selected: node.id === selectedNodeId,
        data: {
          label: node.title,
          title: node.title,
          description: node.description,
        },
        style: nodeStyle,
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
          onNodeClick={(_, node) => onSelectedNodeIdChange(node.id)}
          onPaneClick={() => onSelectedNodeIdChange(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#30323b" gap={18} size={1} />
          <MiniMap
            maskColor="rgba(16, 17, 20, 0.68)"
            nodeColor={(node) => (node.selected ? "#4cc9a6" : "#343842")}
            pannable
            zoomable
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
