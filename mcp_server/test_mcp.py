import asyncio
import sys
import json
from pathlib import Path
from fastmcp import Client
from fastmcp.client.transports import StdioTransport

async def main():
    mcp_script = Path(r"E:\Razorpay-2\mcp_server\server.py")
    print(f"Connecting to: {mcp_script}")
    
    transport = StdioTransport(command=sys.executable, args=[str(mcp_script)])
    client = Client(transport)
    await client.__aenter__()
    
    try:
        # Get all tool definitions
        tools = await client.list_tools()
        
        print(f"\n========== TOTAL TOOLS: {len(tools)} ==========\n")
        
        # For each tool, print the FULL JSON schema exactly as the model sees it
        for tool in tools:
            schema = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.inputSchema
                }
            }
            
            # Pretty print with indent=2 for readability
            print(json.dumps(schema, indent=2, default=str))
            print("-" * 80)

        # Test tool call directly
        print("\n========== TESTING TOOL CALL: run_reconciliation ==========\n")
        res = await client.call_tool("run_reconciliation", {})
        print("Result:", res)
        print("\n[SUCCESS] MCP server tool execution verified!")
            
    except Exception as e:
        print(f"[ERROR] {e}")
        
    finally:
        await client.__aexit__(None, None, None)

if __name__ == "__main__":
    asyncio.run(main())