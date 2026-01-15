# ABOUTME: Temporal client singleton for Flask application
# ABOUTME: Provides client instance for starting and querying workflows

import os
from temporalio.client import Client
import asyncio
import threading


_client = None
_client_loop = None
_client_lock = threading.Lock()


async def get_temporal_client() -> Client:
    """
    Get or create Temporal client singleton.

    Returns:
        Temporal client instance connected to Temporal server
    """
    global _client, _client_loop

    current_loop = asyncio.get_running_loop()

    with _client_lock:
        # If client exists but was created in a different event loop, recreate it
        if _client is not None and _client_loop != current_loop:
            _client = None

        if _client is None:
            temporal_host = os.getenv("TEMPORAL_HOST", "localhost:7233")
            _client = await Client.connect(temporal_host)
            _client_loop = current_loop

    return _client


def run_async(coro):
    """
    Helper to run async code in Flask (which is synchronous).

    Args:
        coro: Coroutine to run

    Returns:
        Result of the coroutine
    """
    # Always create a fresh event loop for Flask requests
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
