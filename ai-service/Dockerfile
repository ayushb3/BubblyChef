FROM python:3.11-slim

WORKDIR /app

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
