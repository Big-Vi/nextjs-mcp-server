import { NextRequest, NextResponse } from "next/server";

// Define our tools
interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any>;
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
  description: "Get DevOps Capabilities",
  inputSchema: {
    type: "object",
    properties: {
      state: {
        type: "string",
        minLength: 2,
        maxLength: 2,
        description: "Two-letter state code (e.g. CA, NY)"
      }
    },
    required: ["state"]
  },
  handler: async ({ state }: { state: string }) => {
    const stateCode = state.toUpperCase();
    const alertsText = `Active alerts for ${stateCode}:\n\nSample DevOps data for ${stateCode}`;

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  },
});

// Simple JSON-RPC handler
async function handleMCPRequest(requestBody: any, sessionId?: string) {
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
        
        const { name: toolName, arguments: toolArgs } = requestBody.params;
        
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
