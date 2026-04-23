export type GraphNodeKind =
  | "project"
  | "chat"
  | "message_summary"
  | "file"
  | "topic"
  | "provider";

export type GraphEdgeKind =
  | "contains"
  | "mentions"
  | "summarizes"
  | "depends_on"
  | "implemented_in"
  | "used_provider"
  | "related_to";

export type GraphMetadataItem = {
  label: string;
  value: string;
};

export type ProjectGraphNode = {
  id: string;
  projectId: string;
  type: GraphNodeKind;
  title: string;
  description: string;
  shortNote: string;
  metadata: GraphMetadataItem[];
  contextPath?: string;
  contextMarkdown?: string;
  filePaths?: string[];
  toolIds?: string[];
  ruleIds?: string[];
  position: {
    x: number;
    y: number;
  };
};

export type ProjectGraphEdge = {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: GraphEdgeKind;
  weight: number;
  label: string;
};
