import type { AgentTool, AgentToolInvocation, AgentToolResult } from './types';

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  async execute(invocation: AgentToolInvocation): Promise<AgentToolResult> {
    const tool = this.tools.get(invocation.name);
    if (!tool) throw new Error(`Agent 工具未注册：${invocation.name}`);
    return tool.execute(invocation.input);
  }

  capabilities(): Array<{ name: string; description: string }> {
    return [...this.tools.values()].map((tool) => ({ name: tool.name, description: tool.description }));
  }
}
