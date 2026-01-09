# DIGIGAMI Guardian Admin Dashboard
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Expose admin port
EXPOSE 8082

# Environment variables
ENV ADMIN_PORT=8082
ENV DIGIGAMI_DB_PATH=/data/guardian.db

# Run the admin server
CMD ["python", "server.py"]
