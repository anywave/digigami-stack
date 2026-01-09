# DIGIGAMI Network Guardian
# DNS-Level Consent Enforcement Layer

FROM python:3.11-slim

LABEL maintainer="DIGIGAMI <hello@digigami.ai>"
LABEL description="Network-level consent enforcement DNS server"
LABEL version="1.0.0"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    dnsutils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY guardian_dns.py .
COPY config/ ./config/

# Create data directory
RUN mkdir -p /var/lib/digigami

# Create non-root user for security
RUN useradd -r -s /bin/false digigami && \
    chown -R digigami:digigami /app /var/lib/digigami

# Note: DNS on port 53 requires root, so we run as root but drop privileges after binding
# For production, consider using CAP_NET_BIND_SERVICE

# Expose ports
EXPOSE 53/udp
EXPOSE 53/tcp
EXPOSE 80/tcp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD dig @localhost -p 53 localhost +short || exit 1

# Environment variables
ENV DIGIGAMI_DNS_PORT=53
ENV DIGIGAMI_UPSTREAM_DNS=8.8.8.8
ENV DIGIGAMI_CLOUD_API=https://api.digigami.ai/v1
ENV DIGIGAMI_SYNC_INTERVAL=30
ENV DIGIGAMI_BLOCK_PAGE_IP=192.168.1.1

# Run the guardian
CMD ["python", "-u", "guardian_dns.py"]
