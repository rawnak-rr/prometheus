import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { memo, useMemo, useState } from "react";

import type { ProjectGraphEdge, ProjectGraphNode } from "@/lib/graph/types";
import styles from "./project-graph.module.css";

type FlowNodeData = Record<string, unknown> & {
  kind: ProjectGraphNode["type"];
  title: string;
  description: string;
  shortNote: string;
  showNote: boolean;
};

type ProjectGraphProps = {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  selectedNodeId: string | null;
  onSelectedNodeIdChange: (nodeId: string | null) => void;
};

const NOTE_ZOOM_THRESHOLD = 0.88;

const nodeTypes = {
  graphNode: memo(function GraphNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
    return (
      <div
        className={[
          styles.graphNode,
          selected ? styles.graphNodeSelected : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={data.description}
      >
        <Handle className={styles.graphHandle} id="left-target" isConnectable={false} position={Position.Left} type="target" />
        <Handle className={styles.graphHandle} id="right-source" isConnectable={false} position={Position.Right} type="source" />
        <Handle className={styles.graphHandle} id="right-target" isConnectable={false} position={Position.Right} type="target" />
        <Handle className={styles.graphHandle} id="left-source" isConnectable={false} position={Position.Left} type="source" />
        <span className={styles.graphNodeDot} />
        <div className={styles.graphNodeCopy}>
          <strong>{data.title}</strong>
          {data.showNote ? <p>{data.shortNote}</p> : null}
        </div>
      </div>
    );
  }),
};

function minimapNodeColor(node: Node) {
  return node.selected ? "#d7e36d" : "#6b7280";
}

export function ProjectGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectedNodeIdChange,
}: ProjectGraphProps) {
  const [zoom, setZoom] = useState(1);

  const flowNodes = useMemo<Node<FlowNodeData>[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "graphNode",
        position: node.position,
        selected: node.id === selectedNodeId,
        draggable: false,
        data: {
          kind: node.type,
          title: node.title,
          description: node.description,
          shortNote: node.shortNote,
          showNote: zoom >= NOTE_ZOOM_THRESHOLD,
        },
      })),
    [nodes, selectedNodeId, zoom],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        label: "",
        animated: edge.weight >= 0.9,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#7a808d",
        },
        style: {
          stroke: "#7a808d",
          strokeOpacity: 1,
          strokeWidth: 2.2,
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
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          onInit={(instance) => setZoom(instance.getZoom())}
          onMove={(_, viewport) => setZoom(viewport.zoom)}
          onNodeClick={(_, node) => onSelectedNodeIdChange(node.id)}
          onPaneClick={() => onSelectedNodeIdChange(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#2c2f37" gap={18} size={1} />
          <MiniMap
            maskColor="rgba(13, 14, 17, 0.74)"
            nodeColor={minimapNodeColor}
            pannable
            zoomable
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
