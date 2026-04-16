FROM python:3.12-slim

# Install Tesseract for OCR
RUN apt-get update && \
    apt-get install -y --no-install-recommends tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Copy application code
COPY bubbly_chef/ bubbly_chef/

EXPOSE 8888

CMD ["uvicorn", "bubbly_chef.main:app", "--host", "0.0.0.0", "--port", "8888"]
