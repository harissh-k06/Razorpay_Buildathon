import os
import json
import sys
import asyncio
import logging
import importlib.util
from typing import Optional, Dict, Any, List
from pathlib import Path
from dotenv import load_dotenv

# Base Paths
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
SKILLS_DIR = BASE_DIR / "workspace" / "skills"
MCP_SCRIPT = PROJECT_ROOT / "mcp_server" / "server.py"

load_dotenv(dotenv_path=PROJECT_ROOT / ".env", override=True)

# Configure logger for chat_bot
logger = logging.getLogger("pennywise.chatbot")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] [PennyWise-Agent] %(message)s", "%H:%M:%S"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

SESSION_STORE: dict[str, list[dict]] = {}

def clear_session(session_id: str = "default"):
    """Clears the conversational memory history for a given session ID."""
    SESSION_STORE[session_id] = []
    logger.info(f"Cleared session history for session '{session_id}'")
    return True

# 1. Load Static System Prompt
def load_system_prompt():
    prompt_path = BASE_DIR / "system_prompt.txt"
    if prompt_path.exists():
        return prompt_path.read_text(encoding="utf-8")
    return "You are PennyWise, a strictly scoped AI Reconciliation Audit Assistant."

# 2. Load Dynamic Skill Catalog (Cheap routing)
def load_skill_catalog():
    catalog_path = BASE_DIR / "skills_catalog.md"
    if catalog_path.exists():
        return catalog_path.read_text(encoding="utf-8")
    return "No skills available."

# 3. Load specific Skill content (Progressive Disclosure)
def load_skill_content(skill_name: str):
    skill_path = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_path.exists():
        skill_path = SKILLS_DIR / f"{skill_name}.md"
    if skill_path.exists():
        content = skill_path.read_text(encoding="utf-8")
        logger.info(f"Loading skill: '{skill_name}' | Skill content returned: {len(content)} chars")
        return content
    logger.warning(f"Skill '{skill_name}' not found at {skill_path}")
    return f"Skill '{skill_name}' not found."

# 4. Dynamic MCP Tool Discovery
async def get_tools_and_client():
    from fastmcp import Client
    
    # Direct in-process FastMCP server client for sub-millisecond tool execution
    if str(PROJECT_ROOT / "mcp_server") not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT / "mcp_server"))
    
    from server import mcp
    logger.info("Connecting to in-process FastMCP server...")
    client = Client(mcp)
    await client.__aenter__()
    
    tools = await client.list_tools()
    tool_names = [t.name for t in tools]
    logger.info(f"Tools discovered: {len(tools)} -> {tool_names}")
    
    if len(tools) == 0:
        logger.error("WARNING: No tools found! Check if server.py is starting correctly.")

    tool_schemas = []
    for tool in tools:
        tool_schemas.append({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.inputSchema
            }
        })

    # Add dynamic skill loader tool
    tool_schemas.append({
        "type": "function",
        "function": {
            "name": "load_skill",
            "description": "Load the content of a specific skill file for the current task.",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {
                        "type": "string",
                        "description": "The name of the skill to load (e.g., 'explaining')."
                    }
                },
                "required": ["skill_name"]
            }
        }
    })
    return client, tool_schemas

# 5. The Final Streaming Agentic Loop
async def stream_chat(message: str, session_id: str = "default", agentic_mode: Optional[bool] = None):
    logger.info(f"Starting stream_chat for session '{session_id}' | Message: '{message}' | agentic_mode: {agentic_mode}")
    from openai import OpenAI
    api_key = os.getenv("MODEL_API_KEY") or os.getenv("API_KEY")
    base_url = os.getenv("MODEL_BASE_URL") or "https://api.deepseek.com"
    model = os.getenv("MODEL_NAME") or "deepseek-chat"
    if not api_key:
        logger.error("MODEL_API_KEY is not set in environment variables!")
    client = OpenAI(api_key=api_key, base_url=base_url)
    
    # 1. Connect to in-process FastMCP and discover all active tools dynamically
    mcp_client, tool_schemas = await get_tools_and_client()

    tools_summary = "\n\n## CURRENT LIVE MCP TOOLS\n" + "\n".join(
        f"- `{t['function']['name']}`: {t['function'].get('description', '').strip().splitlines()[0]}"
        for t in tool_schemas
    )

    # 2. Check and sync authoritative Agentic Mode controller state for this turn
    if agentic_mode is not None:
        is_agentic = bool(agentic_mode)
        try:
            from server import set_agentic_mode
            set_agentic_mode(is_agentic)
        except Exception:
            try:
                from mcp_server.server import set_agentic_mode
                set_agentic_mode(is_agentic)
            except Exception:
                pass
    else:
        try:
            from server import get_agentic_mode
            is_agentic = get_agentic_mode()
        except Exception:
            try:
                from mcp_server.server import get_agentic_mode
                is_agentic = get_agentic_mode()
            except Exception:
                is_agentic = False

    logger.info(f"[PennyWise-Agent] Authoritative Agentic Mode for session '{session_id}': {is_agentic}")

    active_mode_str = "AGENTIC MODE (GREEN / ON — AUTO-EXECUTE ENABLED)" if is_agentic else "ASK MODE (YELLOW / OFF — ACTIONS LOCKED)"
    permission_str = "UNLOCKED: Write, action, memo drafting, and email drafting tools (generate_email_from_exception, draft_dispute_memo, draft_unallocated_cash_memo, update_csv_record, bulk_update_csv, standardize_data, run_reconciliation, configure_matching_parameters, change_currency_and_date, mark_exceptions_resolved, etc.) execute directly." if is_agentic else "LOCKED: Write, action, memo drafting, and email writing tools are locked until Agentic Mode is turned ON."

    mode_status_summary = f"""

## AUTHORITATIVE REAL-TIME CONTROLLER STATUS (THIS EXACT MOMENT):
- **CURRENT ACTIVE MODE**: **{active_mode_str}**
- **STATUS**: **{'AGENTIC_MODE_ON' if is_agentic else 'ASK_MODE_OFF'}**
- **PERMISSIONS**: {permission_str}
- **CRITICAL INSTRUCTION**: The user can toggle this switch in the UI at any time between turns. When asked what mode you are currently in, you MUST report that you are in **{'Agentic Mode (Green / ON)' if is_agentic else 'Ask Mode (Yellow / OFF)'}** strictly matching the current active mode above, ignoring any past messages in the conversation history.
"""

    # 3. Build dynamic system prompt with live mode, tools & skill catalog
    system_prompt = load_system_prompt() + mode_status_summary + tools_summary + "\n\n## SKILL CATALOG\n" + load_skill_catalog()

    # 4. Retrieve or initialize session history
    if session_id not in SESSION_STORE:
        SESSION_STORE[session_id] = []
    
    # 5. Append new user message with active toggle metadata
    mode_label = "Agentic Mode (Green / ON — Write Tools Unlocked)" if is_agentic else "Ask Mode (Yellow / OFF — Write Tools Locked)"
    annotated_message = f"{message}\n\n[Active UI Toggle: {mode_label}]"
    SESSION_STORE[session_id].append({"role": "user", "content": annotated_message})

    # 6. Trim to last 10 messages (5 user + 5 assistant) 
    if len(SESSION_STORE[session_id]) > 10:
        SESSION_STORE[session_id] = SESSION_STORE[session_id][-10:]

    # 7. Build the API messages: System prompt + stored history
    messages = [
        {"role": "system", "content": system_prompt}
    ] + SESSION_STORE[session_id]

    try:
        final_text = ""
        turn_count = 0
        while True:
            turn_count += 1
            tool_names_list = [t['function']['name'] for t in tool_schemas]
            logger.info(f"Turn {turn_count}: Calling LLM API ({model}) with {len(tool_schemas)} tools: {tool_names_list}")
            
            # Stream the API response
            stream = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tool_schemas,
                stream=True
            )

            tool_calls_buffer = {}
            turn_text = ""
            turn_chunks = []
            token_count = 0
            
            # Process streaming chunks
            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                
                # Stream token immediately in real-time as it arrives
                if delta.content:
                    turn_text += delta.content
                    final_text += delta.content
                    token_count += 1
                    yield f"data: {json.dumps({'token': delta.content})}\n\n"
                
                # Capture tool calls
                if delta.tool_calls:
                    logger.info(f"Tool call delta detected: {delta.tool_calls}")
                    for tc in delta.tool_calls:
                        index = tc.index
                        if index not in tool_calls_buffer:
                            tool_calls_buffer[index] = {"id": "", "name": "", "args": ""}
                        if tc.id:
                            tool_calls_buffer[index]["id"] = tc.id
                        if tc.function and tc.function.name:
                            tool_calls_buffer[index]["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            tool_calls_buffer[index]["args"] += tc.function.arguments

            if token_count > 0:
                logger.info(f"Turn {turn_count}: Streamed {token_count} tokens from LLM ({model}).")

            # If tool calls were requested, execute them
            if tool_calls_buffer:
                logger.info(f"Executing {len(tool_calls_buffer)} tool call(s) requested by model...")
                # Append assistant message with tool calls for proper conversation context
                messages.append({
                    "role": "assistant",
                    "content": turn_text or None,
                    "tool_calls": [
                        {
                            "id": data["id"],
                            "type": "function",
                            "function": {"name": data["name"], "arguments": data["args"]}
                        }
                        for data in tool_calls_buffer.values()
                    ]
                })

                # Execute all tools
                for data in tool_calls_buffer.values():
                    tool_name = data["name"]
                    try:
                        args = json.loads(data["args"]) if data["args"] else {}
                    except Exception as parse_err:
                        logger.error(f"Failed to parse tool arguments '{data['args']}': {parse_err}")
                        args = {}

                    logger.info(f"Executing tool: '{tool_name}' with args: {args}")
                    
                    # Special tool for skills
                    if tool_name == "load_skill":
                        result_text = load_skill_content(args.get("skill_name", ""))
                    else:
                        # Call actual MCP tool
                        try:
                            result = await mcp_client.call_tool(tool_name, args)
                            if hasattr(result, "content") and result.content:
                                result_text = result.content[0].text if isinstance(result.content[0], dict) else str(result.content[0])
                            else:
                                result_text = str(result)
                        except Exception as tool_err:
                            logger.error(f"Error executing MCP tool '{tool_name}': {tool_err}")
                            result_text = json.dumps({"error": str(tool_err)})

                    logger.info(f"Tool '{tool_name}' result: {result_text[:500]}{'...' if len(result_text) > 500 else ''}")

                    # If this tool modified data, emit an immediate SSE action event so frontend updates in real time
                    action_name = None
                    target_name = "review"
                    try:
                        parsed_res = json.loads(result_text) if isinstance(result_text, str) else result_text
                        if isinstance(parsed_res, dict) and parsed_res.get("action"):
                            action_name = parsed_res.get("action")
                            target_name = parsed_res.get("target") or parsed_res.get("source") or "review"
                    except Exception:
                        pass

                    if not action_name and tool_name in [
                        "update_csv_record", "bulk_update_csv", "standardize_data",
                        "change_currency_and_date", "revert_last_action", "mark_exceptions_resolved",
                        "resolve_exceptions_bulk"
                    ]:
                        action_name = "data_refresh"
                        target_name = "review"

                    if action_name:
                        logger.info(f"Emitting real-time action event: {action_name} (target: {target_name}) for tool '{tool_name}'")
                        yield f"data: {json.dumps({'action': action_name, 'target': target_name, 'tool': tool_name})}\n\n"

                    # Append tool result
                    messages.append({
                        "role": "tool",
                        "tool_call_id": data["id"],
                        "content": result_text
                    })
                
                # Loop back to get the final answer with tool results incorporated
                continue

            # If no tool calls, response is complete!
            else:
                # Append final assistant response to history
                SESSION_STORE[session_id].append({"role": "assistant", "content": final_text})
                if len(SESSION_STORE[session_id]) > 10:
                    SESSION_STORE[session_id] = SESSION_STORE[session_id][-10:]
                break

        logger.info(f"Stream complete for session '{session_id}' | Total response length: {len(final_text)} chars")
        yield f"data: {json.dumps({'done': True})}\n\n"
        
    finally:
        logger.info("Closing MCP client session transport.")
        await mcp_client.__aexit__(None, None, None)


# CLI Testing
if __name__ == "__main__":
    print("PennyWise CLI Started. Type 'exit' to quit.")
    while True:
        user_input = input("\nYou: ").strip()
        if user_input.lower() in ["exit", "quit"]:
            break
        print("\nPennyWise: ", end="")
        async def run_cli():
            async for chunk in stream_chat(user_input):
                data = json.loads(chunk.replace("data: ", "").strip())
                if data.get("token"):
                    print(data["token"], end="", flush=True)
        asyncio.run(run_cli())
        print()