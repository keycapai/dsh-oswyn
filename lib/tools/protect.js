/**
 * dsh-oswyn/tools/protect — register `oswyn_protect_tool`.
 *
 * Lets the agent add/remove a tool name from the runtime protected list used by
 * the tiered automatic compressor. The list is persisted under
 * ~/.dsh/storages/oswyn/protected-tools.json and merged into the config value.
 *
 * @module dsh-oswyn/tools/protect
 */

import { addProtectedTool, loadProtectedTools } from '../store/ledger.js';

export function registerProtectTool(ctx) {
  if (!ctx?.tools || typeof ctx.tools.register !== 'function') return;
  ctx.tools.register({
    name: 'oswyn_protect_tool',
    description: 'Add or remove a tool name from the OSWYN auto-compress protection list. Protected tools are never auto-compressed by autoCompressTiered.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tool: { type: 'string', description: 'Tool name to protect, e.g. "read" or "my_custom_tool". Supports trailing * wildcard.' },
        protected: { type: 'boolean', description: 'true (default) adds protection; false removes it.' }
      },
      required: ['tool']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tool: { type: 'string' },
          protected: { type: 'boolean' },
          tools: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' }
        },
        required: ['tool', 'protected', 'summary']
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }]
    },
    execute(args) {
      const tool = String(args?.tool || '').trim();
      if (!tool) return { tool: '', protected: false, tools: loadProtectedTools(), summary: 'oswyn_protect_tool: missing tool name' };
      const shouldProtect = args?.protected !== false;
      const tools = addProtectedTool(tool, shouldProtect);
      return {
        tool,
        protected: shouldProtect,
        tools,
        summary: (shouldProtect ? '已加入自动压缩保护名单：' : '已移出自动压缩保护名单：') + tool + '\n当前保护工具：' + (tools.length ? tools.join(', ') : '（空）')
      };
    }
  });
}
