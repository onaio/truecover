# ABOUTME: Temporal client singleton for Flask application
# ABOUTME: Provides client instance for starting and querying workflows

import os
from temporalio.client import Client
import asyncio


_client = None
_client_lock = asyncio.Lock()


async def get_temporal_client() -> Client:
    """
    Get or create Temporal client singleton.

    Returns:
        Temporal client instance connected to Temporal server
    """
    global _client

    async with _client_lock:
        if _client is None:
            # Get Temporal server address from environment or use default
            temporal_host = os.getenv("TEMPORAL_HOST", "localhost:7233")
            _client = await Client.connect(temporal_host)

    return _client


def run_async(coro):
    """
    Helper to run async code in Flask (which is synchronous).

    Args:
        coro: Coroutine to run

    Returns:
        Result of the coroutine
    """
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    return loop.run_until_complete(coro)
