# ABOUTME: Multi-stage Docker build for Flask backend using uv.
# ABOUTME: Produces an optimized Python image running gunicorn.

# Build stage
FROM python:3.12-slim AS build

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy source files
COPY . .

# Production stage
FROM python:3.12-slim

# Install runtime dependencies for geospatial libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libgdal36 \
    libgeos-c1t64 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy virtual environment from build stage
COPY --from=build /app/.venv /app/.venv

# Copy application code
COPY --from=build /app .

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

EXPOSE 5000

# Run with gunicorn
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]
