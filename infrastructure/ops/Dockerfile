# Minimal ops image for scheduled tasks (AKS CronJobs).
#
# Build context: repo root (.)
# Build: docker build -f infrastructure/ops/Dockerfile -t buildatlas-ops:latest .
FROM python:3.11-slim

WORKDIR /app

COPY scripts/posthog_usage_to_slack.py ./posthog_usage_to_slack.py

ENV PYTHONUNBUFFERED=1

CMD ["python", "/app/posthog_usage_to_slack.py"]

