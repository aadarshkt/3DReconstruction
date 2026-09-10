FROM python:3.11-slim

# System deps: COLMAP build deps + ffmpeg + libGL (Open3D)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    git \
    wget \
    colmap \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Data directory for job files
RUN mkdir -p /app/data

EXPOSE 8000
