"""
Hefai Backend — FastAPI Microservice
Handles: Memory (mem0 + SuperMemory), Web Search (LLM tool + Exa + Firecrawl), Multi-AI Collaboration
"""

import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load environment variables (single source — root .env)
load_dotenv(Path(__file__).parent.parent / ".env")

# Add vendor/mem0 to Python path so we can import it directly
vendor_mem0_path = str(Path(__file__).parent / "vendor" / "mem0")
if vendor_mem0_path not in sys.path:
    sys.path.insert(0, vendor_mem0_path)

from routers import memory, search, agents, code, reports
from auth import verify_api_key


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup, cleanup on shutdown."""
    from services.mem0_service import init_mem0
    from services.supermemory_service import init_supermemory
    from services.code_executor import shutdown_code_executor

    print("🧠 Initializing mem0 memory system...")
    await init_mem0()
    print("👤 Initializing SuperMemory user profiles...")
    await init_supermemory()
    print("✅ Backend services ready!")
    yield
    await shutdown_code_executor()
    print("🔒 Shutting down backend services...")


app = FastAPI(
    title="Hefai Backend",
    description="Memory, Search, and Multi-AI Collaboration service for Hefai",
    version="1.0.0",
    lifespan=lifespan,
    dependencies=[Depends(verify_api_key)],
)

# CORS — allow Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        os.getenv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

# Mount routers
app.include_router(memory.router, prefix="/memory", tags=["Memory"])
app.include_router(search.router, prefix="/search", tags=["Search"])
app.include_router(agents.router, prefix="/agents", tags=["Agents"])
app.include_router(code.router, prefix="/code", tags=["Code"])
app.include_router(reports.router, prefix="/reports", tags=["Reports"])


@app.get("/health", dependencies=[])
async def health_check():
    return {
        "status": "healthy",
        "service": "hefai-backend",
        "features": ["mem0", "supermemory", "web-search", "exa-search", "multi-ai", "code-execution", "pdf-reports"],
    }
