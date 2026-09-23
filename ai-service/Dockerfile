FROM python:3.11-slim

WORKDIR /app

# Deployed commit SHA (agent-loop step 3): pass with
# `docker build --build-arg GIT_SHA=$(git rev-parse HEAD) .` at deploy time so
# /health and /health/ai can report which commit is actually serving. Optional
# — a plain `docker build` with no build args leaves this empty and the app
# falls back to Railway's own RAILWAY_GIT_COMMIT_SHA, then "unknown".
ARG GIT_SHA=""
ENV BUBBLY_GIT_SHA=${GIT_SHA}

# Install pinned runtime dependencies first — this layer only changes when
# requirements.lock changes, so it stays cached across app-code-only rebuilds.
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

# Install the bubbly_chef package itself, without re-resolving deps.
COPY pyproject.toml .
COPY bubbly_chef/ bubbly_chef/
RUN pip install --no-cache-dir --no-deps .

EXPOSE 8888

CMD ["uvicorn", "bubbly_chef.main:app", "--host", "0.0.0.0", "--port", "8888"]
