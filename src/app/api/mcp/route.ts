import { NextRequest, NextResponse } from "next/server";

// Define types for MCP protocol
interface ToolContent {
  type: string;
  text?: string;
  data?: unknown;
}

interface ToolResult {
  content: ToolContent[];
}

interface InputSchemaProperty {
  type: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  description?: string;
}

interface InputSchema {
  type: string;
  properties: Record<string, InputSchemaProperty>;
  required?: string[];
}

interface ToolArgs {
  format?: string;
  [key: string]: unknown;
}

// Define our tools
interface Tool {
  name: string;
  description: string;
  inputSchema: InputSchema;
  handler: (args: ToolArgs) => Promise<ToolResult>;
}

// Session management
interface Session {
  id: string;
  initialized: boolean;
  createdAt: Date;
}

const sessions = new Map<string, Session>();

// Generate session ID
function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Get or create session
function getOrCreateSession(sessionId?: string): Session {
  if (!sessionId) {
    sessionId = generateSessionId();
  }
  
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      initialized: false,
      createdAt: new Date()
    };
    sessions.set(sessionId, session);
  }
  
  return session;
}

// Store tools in a Map
const tools = new Map<string, Tool>();

// Register devops_capabilities tool
tools.set("devops_capabilities", {
  name: "devops_capabilities",
  description: "Get DevOps Capabilities - lists available DevOps operations like debugging, deployment, monitoring, etc.",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: ["list", "detailed", "json"],
        description: "Output format for capabilities (optional, defaults to 'list')"
      }
    },
    required: [] // No required inputs - this tool can be called without parameters
  },
  handler: async ({ format = "list" }: { format?: string }) => {
    const capabilities = [
      "debugging",
      "deployment", 
      "monitoring",
      "logging",
      "scaling",
      "backup",
      "security-scanning",
      "performance-testing",
      "infrastructure-provisioning",
      "ci-cd-pipeline"
    ];

    let responseText;
    
    if (format === "detailed") {
      responseText = `DevOps Capabilities (Detailed):\n\n` +
        capabilities.map(cap => `• ${cap}: Available for execution`).join('\n');
    } else if (format === "json") {
      responseText = JSON.stringify({ capabilities, count: capabilities.length }, null, 2);
    } else {
      responseText = `Available DevOps Capabilities:\n\n${capabilities.join(", ")}`;
    }

    return {
      content: [
        {
          type: "text",
          text: responseText,
        },
      ],
    };
  },
});

// JSON-RPC request types
interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: {
    name?: string;
    arguments?: ToolArgs;
  };
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

// Simple JSON-RPC handler
async function handleMCPRequest(requestBody: JsonRpcRequest, sessionId?: string): Promise<JsonRpcResponse> {
  // Auto-initialize session if not provided or not found
  if (!sessionId || !sessions.has(sessionId)) {
    sessionId = generateSessionId();
    const session = {
      id: sessionId,
      initialized: false,
      createdAt: new Date()
    };
    sessions.set(sessionId, session);
  }
  
  const session = sessions.get(sessionId)!;
  
  try {
    switch (requestBody.method) {
      case 'initialize':
        session.initialized = true;
        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'devops-mcp-server',
              version: '1.0.0'
            }
          }
        };
        
      case 'tools/list':
        // Auto-initialize if not initialized
        if (!session.initialized) {
          session.initialized = true;
        }
        
        const toolsList = Array.from(tools.values()).map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));
        
        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          result: { tools: toolsList }
        };
        
      case 'tools/call':
        // Auto-initialize if not initialized
        if (!session.initialized) {
          session.initialized = true;
        }
        
        const toolName = requestBody.params?.name;
        const toolArgs = requestBody.params?.arguments || {};
        
        if (!toolName) {
          throw new Error('Tool name is required');
        }
        
        const tool = tools.get(toolName);
        if (!tool) {
          throw new Error(`Tool ${toolName} not found`);
        }
        
        const result = await tool.handler(toolArgs);
        
        return {
          jsonrpc: '2.0',
          id: requestBody.id,
          result
        };
        
      default:
        throw new Error(`Unknown method: ${requestBody.method}`);
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: requestBody.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error'
      }
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const sessionId = request.headers.get('mcp-session-id') || generateSessionId();
    
    switch (action) {
      case 'list-tools':
        const session = getOrCreateSession(sessionId);
        if (!session.initialized) {
          return NextResponse.json({ error: 'Session not initialized' }, { 
            status: 400,
            headers: { 'mcp-session-id': session.id }
          });
        }
        
        const toolsList = Array.from(tools.values()).map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));
        
        return NextResponse.json({ tools: toolsList }, {
          headers: { 'mcp-session-id': session.id }
        });
        
      case 'status':
        return NextResponse.json({ 
          status: 'running',
          server: 'devops-mcp-server',
          version: '1.0.0'
        }, {
          headers: { 'mcp-session-id': sessionId }
        });
        
      case 'new-session':
        const newSession = getOrCreateSession();
        return NextResponse.json({
          sessionId: newSession.id,
          message: 'New session created'
        }, {
          headers: { 'mcp-session-id': newSession.id }
        });
        
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('MCP Server Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = request.headers.get('mcp-session-id') || generateSessionId();
    
    // Handle JSON-RPC requests
    if (body.jsonrpc === '2.0') {
      const result = await handleMCPRequest(body, sessionId);
      
      // Return as Server-Sent Events for compatibility
      const responseText = `event: message\ndata: ${JSON.stringify(result)}\n\n`;
      
      return new NextResponse(responseText, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'mcp-session-id': sessionId,
        },
      });
    }
    
    // Handle simple POST requests
    const { action, toolName, arguments: toolArgs } = body;
    
    if (action === 'call-tool') {
      const session = getOrCreateSession(sessionId);
      if (!session.initialized) {
        session.initialized = true; // Auto-initialize
      }
      
      const tool = tools.get(toolName);
      if (!tool) {
        return NextResponse.json({ error: `Tool ${toolName} not found` }, { 
          status: 404,
          headers: { 'mcp-session-id': session.id }
        });
      }
      
      const result = await tool.handler(toolArgs || {});
      return NextResponse.json({ result }, {
        headers: { 'mcp-session-id': session.id }
      });
    }
    
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    console.error('MCP Server Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
