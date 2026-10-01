FROM python:3.10-slim

# Set environment variables

ENV PYTHONDONTWRITEBYTECODE=1

ENV PYTHONUNBUFFERED=1

ENV PORT=8000

# Set working directory

WORKDIR /app       

RUN apt-get update && apt-get install -y --no-install-recommends \

    build-essential \

    default-jdk \

    libgl1 \

    libglib2.0-0 \

    libgomp1 \

    libsm6 \

    libxext6 \

    libxrender1 \
&& rm -rf /var/lib/apt/lists/*

# Copy and install requirements

COPY requirements.txt /app/

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Copy application files

COPY . /app/

# Expose backend port

EXPOSE 8000

# Run Alembic migrations on startup and start Gunicorn

CMD ["sh", "-c", "alembic upgrade head && gunicorn main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 600"]

                                          


 