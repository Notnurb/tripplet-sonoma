"""
Agent Service — Multi-AI Collaboration
Tura 3 can invite other AI agents to collaborate.
- 1-4 agents: sequential LLM calls with unique personas
- 5+ agents: parallel LLM calls for faster processing

Each agent gets a unique persona and system prompt.
Tura 3 orchestrates and synthesizes the final answer.
"""

import asyncio
import httpx
from typing import Optional
from datetime import datetime

from services.llm_client import (
    is_configured,
    not_configured_error,
    chat_completions_url,
    auth_headers,
    model,
    synthesis_model,
)


# ─── Agent Personas ───────────────────────────────────────────────────────────

AGENT_ROSTER = [
    {
        "id": "analyst",
        "name": "Analyst",
        "emoji": "📊",
        "persona": "You are a sharp Data Analyst. Break down information with data-driven insights, statistics, and comparisons. Be precise and quantitative.",
        "specialty": "Data analysis, statistics, comparisons",
    },
    {
        "id": "coder",
        "name": "Coder",
        "emoji": "💻",
        "persona": "You are an expert Software Engineer. Provide clean, production-quality code with best practices. Focus on architecture, patterns, and implementation details.",
        "specialty": "Code generation, debugging, architecture",
    },
    {
        "id": "researcher",
        "name": "Researcher",
        "emoji": "🔬",
        "persona": "You are a thorough Academic Researcher. Provide deep, well-cited analysis. Consider multiple perspectives and present evidence-based conclusions.",
        "specialty": "Deep research, citations, thorough analysis",
    },
    {
        "id": "creative",
        "name": "Creative",
        "emoji": "🎨",
        "persona": "You are a Creative Writer and Ideator. Think outside the box, brainstorm novel solutions, and present ideas in engaging, imaginative ways.",
        "specialty": "Brainstorming, ideation, storytelling",
    },
    {
        "id": "critic",
        "name": "Critic",
        "emoji": "🔍",
        "persona": "You are a Devil's Advocate. Challenge assumptions, identify weaknesses, find edge cases, and stress-test ideas. Be constructively critical.",
        "specialty": "Challenging assumptions, finding flaws",
    },
    {
        "id": "planner",
        "name": "Planner",
        "emoji": "📋",
        "persona": "You are a Project Manager. Structure tasks into clear action items, timelines, and milestones. Focus on execution and deliverables.",
        "specialty": "Task structure, timelines, action items",
    },
    {
        "id": "security",
        "name": "Security",
        "emoji": "🛡️",
        "persona": "You are a Security Expert. Identify risks, vulnerabilities, and potential threats. Suggest mitigations and best practices for safety.",
        "specialty": "Risk assessment, vulnerabilities, mitigations",
    },
    {
        "id": "ux",
        "name": "UX Designer",
        "emoji": "🎯",
        "persona": "You are a UX Designer. Focus on user experience, accessibility, design thinking, and human-centered approaches to problem-solving.",
        "specialty": "User experience, design thinking",
    },
    {
        "id": "optimizer",
        "name": "Optimizer",
        "emoji": "⚡",
        "persona": "You are a Performance Expert. Find efficiency improvements, optimize workflows, reduce redundancy, and suggest faster approaches.",
        "specialty": "Efficiency, optimization, performance",
    },
    {
        "id": "educator",
        "name": "Educator",
        "emoji": "📚",
        "persona": "You are a Patient Educator. Explain complex concepts simply, use analogies, and ensure deep understanding. Teach, don't just tell.",
        "specialty": "Teaching, simplification, analogies",
    },
    {
        "id": "ethicist",
        "name": "Ethicist",
        "emoji": "⚖️",
        "persona": "You are an Ethics Advisor. Consider moral implications, fairness, bias, and social impact. Ensure responsible and ethical approaches.",
        "specialty": "Ethics, fairness, social impact",
    },
    {
        "id": "strategist",
        "name": "Strategist",
        "emoji": "♟️",
        "persona": "You are a Strategic Thinker. Look at the big picture, identify long-term implications, competitive advantages, and strategic opportunities.",
        "specialty": "Strategy, long-term thinking, competitive analysis",
    },
    {
        "id": "debugger",
        "name": "Debugger",
        "emoji": "🐛",
        "persona": "You are a Debugging Expert. Systematically identify root causes, trace issues, and provide clear fix steps. Think methodically.",
        "specialty": "Root cause analysis, systematic debugging",
    },
    {
        "id": "architect",
        "name": "Architect",
        "emoji": "🏗️",
        "persona": "You are a Systems Architect. Design scalable, maintainable systems. Focus on component boundaries, data flow, and integration patterns.",
        "specialty": "System design, scalability, architecture",
    },
    {
        "id": "writer",
        "name": "Writer",
        "emoji": "✍️",
        "persona": "You are a Technical Writer. Create clear, well-structured documentation. Focus on readability, completeness, and proper formatting.",
        "specialty": "Documentation, clarity, structure",
    },
    {
        "id": "devops",
        "name": "DevOps",
        "emoji": "🚀",
        "persona": "You are a DevOps Engineer. Focus on deployment, CI/CD, infrastructure, monitoring, and operational excellence.",
        "specialty": "Deployment, infrastructure, automation",
    },
    {
        "id": "data_eng",
        "name": "Data Engineer",
        "emoji": "🔧",
        "persona": "You are a Data Engineer. Focus on data pipelines, storage, processing, and ensuring data quality and accessibility.",
        "specialty": "Data pipelines, storage, ETL",
    },
    {
        "id": "ml_eng",
        "name": "ML Engineer",
        "emoji": "🤖",
        "persona": "You are an ML Engineer. Focus on model selection, training approaches, evaluation metrics, and practical ML applications.",
        "specialty": "Machine learning, model training, evaluation",
    },
    {
        "id": "product",
        "name": "Product Manager",
        "emoji": "📱",
        "persona": "You are a Product Manager. Focus on user needs, feature prioritization, market fit, and building the right thing for the right audience.",
        "specialty": "Product strategy, user needs, prioritization",
    },
    {
        "id": "legal",
        "name": "Legal Advisor",
        "emoji": "📜",
        "persona": "You are a Legal Advisor. Consider regulations, compliance, intellectual property, and legal implications of decisions.",
        "specialty": "Regulations, compliance, IP",
    },
    {
        "id": "financial",
        "name": "Financial Analyst",
        "emoji": "💰",
        "persona": "You are a Financial Analyst. Focus on cost-benefit analysis, budgeting, ROI calculations, and financial viability.",
        "specialty": "Financial analysis, ROI, budgeting",
    },
    {
        "id": "accessibility",
        "name": "Accessibility Expert",
        "emoji": "♿",
        "persona": "You are an Accessibility Expert. Ensure inclusive design, WCAG compliance, and solutions that work for everyone regardless of ability.",
        "specialty": "Accessibility, inclusive design, WCAG",
    },
    {
        "id": "localization",
        "name": "Localization Expert",
        "emoji": "🌍",
        "persona": "You are a Localization Expert. Consider internationalization, cultural sensitivity, translation needs, and global audience adaptation.",
        "specialty": "i18n, cultural adaptation, translation",
    },
    {
        "id": "testing",
        "name": "QA Engineer",
        "emoji": "✅",
        "persona": "You are a QA Engineer. Focus on test coverage, edge cases, regression testing, and quality assurance strategies.",
        "specialty": "Testing, quality assurance, edge cases",
    },
    {
        "id": "mentor",
        "name": "Mentor",
        "emoji": "🧙",
        "persona": "You are a Senior Mentor. Provide wisdom, guidance, career advice, and help others grow. Share lessons learned from experience.",
        "specialty": "Mentorship, wisdom, growth guidance",
    },
]


def select_agents(query: str, num_agents: int) -> list[dict]:
    """
    Intelligently select the most relevant agents for a given query.
    Tura 3 always selects, aiming for 5+ agents when beneficial.
    """
    query_lower = query.lower()

    # Keyword-based relevance scoring
    scores = []
    for agent in AGENT_ROSTER:
        score = 0
        specialty_words = agent["specialty"].lower().split(", ")
        for word in specialty_words:
            if any(w in query_lower for w in word.split()):
                score += 2

        # Boost certain agents for common query types
        if any(w in query_lower for w in ["code", "program", "function", "bug", "error"]):
            if agent["id"] in ["coder", "debugger", "architect", "testing"]:
                score += 3
        if any(w in query_lower for w in ["design", "ui", "ux", "interface"]):
            if agent["id"] in ["ux", "creative", "accessibility"]:
                score += 3
        if any(w in query_lower for w in ["plan", "strategy", "roadmap"]):
            if agent["id"] in ["planner", "strategist", "product"]:
                score += 3
        if any(w in query_lower for w in ["security", "risk", "vulnerable"]):
            if agent["id"] in ["security", "critic"]:
                score += 3
        if any(w in query_lower for w in ["data", "analytics", "metrics"]):
            if agent["id"] in ["analyst", "data_eng", "ml_eng"]:
                score += 3
        if any(w in query_lower for w in ["learn", "explain", "understand", "how"]):
            if agent["id"] in ["educator", "mentor"]:
                score += 3

        # Base score for diversity
        score += 1
        scores.append((agent, score))

    # Sort by relevance, take top N
    scores.sort(key=lambda x: x[1], reverse=True)
    selected = [s[0] for s in scores[:min(num_agents, len(AGENT_ROSTER))]]
    return selected


# ─── Sequential Collaboration (1-4 agents) ────────────────────────────────────

async def collaborate_sequential(
    query: str,
    agents: list[dict],
    conversation_history: list[dict] = None,
) -> dict:
    """Run agents sequentially, each building on the previous responses."""
    if not is_configured():
        return {"error": not_configured_error()}

    results = []
    context_accumulator = ""

    async with httpx.AsyncClient(timeout=120.0) as client:
        for agent in agents:
            system_prompt = (
                f"{agent['persona']}\n\n"
                f"You are collaborating with other AI agents to answer a question. "
                f"The user asked: \"{query}\"\n"
            )
            if context_accumulator:
                system_prompt += (
                    f"\nPrevious agents have shared these insights:\n{context_accumulator}\n\n"
                    f"Build on their work — add your unique perspective as {agent['name']}. "
                    f"Don't repeat what others said; contribute new value."
                )

            messages = [{"role": "system", "content": system_prompt}]
            if conversation_history:
                messages.extend(conversation_history)
            messages.append({"role": "user", "content": query})

            try:
                resp = await client.post(
                    chat_completions_url(),
                    headers=auth_headers(),
                    json={
                        "model": model(),
                        "messages": messages,
                        "max_tokens": 1500,
                        "temperature": 0.7,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]

                results.append({
                    "agent": {
                        "id": agent["id"],
                        "name": agent["name"],
                        "emoji": agent["emoji"],
                        "specialty": agent["specialty"],
                    },
                    "content": content,
                    "timestamp": datetime.utcnow().isoformat(),
                })
                context_accumulator += f"\n{agent['name']}: {content[:500]}\n"

            except Exception as e:
                results.append({
                    "agent": {
                        "id": agent["id"],
                        "name": agent["name"],
                        "emoji": agent["emoji"],
                    },
                    "content": f"Error: {str(e)}",
                    "error": True,
                })

    return {
        "mode": "sequential",
        "query": query,
        "agent_count": len(agents),
        "responses": results,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── Batch Collaboration (5+ agents) ──────────────────────────────────────────

async def collaborate_batch(
    query: str,
    agents: list[dict],
    conversation_history: list[dict] = None,
) -> dict:
    """Run 5+ agents in parallel via the LLM backend for faster processing."""
    if not is_configured():
        return {"error": not_configured_error()}

    return await _batch_via_http(query, agents, conversation_history)


async def _batch_via_http(
    query: str,
    agents: list[dict],
    conversation_history: list[dict],
) -> dict:
    """Run all agents in parallel via the OpenAI-compatible HTTP API."""

    async def call_agent(agent: dict) -> dict:
        system_prompt = (
            f"{agent['persona']}\n\n"
            f"You are one of {len(agents)} AI agents collaborating to answer a question. "
            f"Provide your unique perspective as {agent['name']}. Be thorough but concise."
        )
        messages = [{"role": "system", "content": system_prompt}]
        if conversation_history:
            messages.extend(conversation_history)
        messages.append({"role": "user", "content": query})

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post(
                    chat_completions_url(),
                    headers=auth_headers(),
                    json={
                        "model": model(),
                        "messages": messages,
                        "max_tokens": 1500,
                        "temperature": 0.7,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                return {
                    "agent": {
                        "id": agent["id"],
                        "name": agent["name"],
                        "emoji": agent["emoji"],
                        "specialty": agent["specialty"],
                    },
                    "content": content,
                    "timestamp": datetime.utcnow().isoformat(),
                }
            except Exception as e:
                return {
                    "agent": {
                        "id": agent["id"],
                        "name": agent["name"],
                        "emoji": agent["emoji"],
                    },
                    "content": f"Error: {str(e)}",
                    "error": True,
                }

    # Run all in parallel
    tasks = [call_agent(agent) for agent in agents]
    results = await asyncio.gather(*tasks)

    return {
        "mode": "batch_http",
        "query": query,
        "agent_count": len(agents),
        "responses": list(results),
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── Synthesize Final Answer ──────────────────────────────────────────────────

async def synthesize_responses(
    query: str,
    collaboration_result: dict,
) -> str:
    """Tura 3 synthesizes all agent responses into a unified answer."""
    if not is_configured():
        return f"Error: {not_configured_error()}"

    responses = collaboration_result.get("responses", [])
    agent_inputs = "\n\n".join([
        f"### {r['agent']['emoji']} {r['agent']['name']}:\n{r['content']}"
        for r in responses if not r.get("error")
    ])

    system_prompt = (
        "You are Tura 3, the lead AI orchestrator. Multiple AI agents have shared their perspectives "
        "on the user's question. Your job is to:\n"
        "1. Synthesize all perspectives into a comprehensive, unified answer\n"
        "2. Highlight where agents agreed and any important disagreements\n"
        "3. Add your own analysis where the agents missed something\n"
        "4. Structure the final answer clearly with appropriate formatting\n"
        "5. Credit individual agents when referencing their specific insights\n\n"
        "Be thorough, well-structured, and provide the best possible answer."
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(
                chat_completions_url(),
                headers=auth_headers(),
                json={
                    "model": synthesis_model(),  # stronger model for final synthesis
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {
                            "role": "user",
                            "content": (
                                f"Original question: {query}\n\n"
                                f"Agent responses:\n{agent_inputs}"
                            ),
                        },
                    ],
                    "max_tokens": 4000,
                    "temperature": 0.5,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            return f"Synthesis error: {str(e)}\n\nRaw agent responses:\n{agent_inputs}"


# ─── Main Orchestration ───────────────────────────────────────────────────────

async def orchestrate_collaboration(
    query: str,
    num_agents: Optional[int] = None,
    conversation_history: list[dict] = None,
) -> dict:
    """
    Main entry point for multi-AI collaboration.
    Tura 3 decides how many agents to invite (defaults to 5+).
    Uses batch API for 5+ agents, sequential for 1-4.
    """
    # Default to 7 agents (leans towards 5+)
    if num_agents is None:
        num_agents = 7

    # Clamp to 1-25
    num_agents = max(1, min(25, num_agents))

    # Select the best agents for this query
    selected = select_agents(query, num_agents)

    # Choose collaboration mode
    if len(selected) >= 5:
        result = await collaborate_batch(query, selected, conversation_history)
    else:
        result = await collaborate_sequential(query, selected, conversation_history)

    # Synthesize final answer
    synthesis = await synthesize_responses(query, result)
    result["synthesis"] = synthesis

    return result
