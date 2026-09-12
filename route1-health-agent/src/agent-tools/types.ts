export type AgentToolName = 'home.find_item';

export interface FindHomeItemInput {
  query: string;
}

export interface AgentToolInvocation {
  name: AgentToolName;
  input: FindHomeItemInput;
}

export interface AgentToolResult {
  ok: boolean;
  tool: AgentToolName;
  message: string;
  source: 'route2-home-twin';
  dataMode: 'real' | 'demo' | 'unknown';
  target?: { url: string; label: string };
}

export interface AgentTool<TInput = unknown> {
  name: AgentToolName;
  description: string;
  execute(input: TInput): Promise<AgentToolResult>;
}
