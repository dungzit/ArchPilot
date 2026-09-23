# Single-container deployment (PO decision 7: on-prem Docker host).
# Stage 1 builds ArchPilot's existing React/Vite SPA.
# Stage 2 runs the FastAPI backend and serves the built SPA from the same origin.
#
# Build from the ArchPilot/ directory so the SPA sources are in context:
#   docker build -f backend/Dockerfile -t archpilot:dev .

# node:20 went end-of-life 2026-04-30, and the toolchain has moved past it:
# vite 8 needs ^20.19 || >=22.12 and jsdom 30 needs >=22.22.2. CI pins the same
# major (.github/workflows/ci.yml). Undo = change 24 back to 20 on this line.
FROM node:24-alpine AS spa
WORKDIR /spa
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim AS runtime
# review-2 fix: the image declares ARCHPILOT_ENV=production, and
# app/config.py:validate() refuses to start a production process that still has
# cookie_secure=false or a loopback CORS origin. Both of those are the *defaults*,
# so `docker run archpilot:dev` with no -e flags crashed at import:
#   ValueError: ARCHPILOT_COOKIE_SECURE must be true in production
# Reproduced on 2026-09-23 with `ARCHPILOT_ENV=production python -c "import app.main"`.
# The image must therefore ship the production values for the environment it
# declares. An EMPTY ARCHPILOT_CORS_ORIGINS is the documented way to say "no CORS
# origins" (config.py:_env_list) and is correct here: the SPA is served
# same-origin from ./static by this very container.
#
# NOTE for devops (task 0.8): ARCHPILOT_COOKIE_SECURE=true means the session
# cookie is only sent over HTTPS. If the on-prem host terminates TLS in front of
# this container, keep it. If it will genuinely be served over plain HTTP, that
# is a deployment decision to make explicitly - do NOT flip ARCHPILOT_ENV back to
# development to work around it, because that also re-enables /api/docs.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ARCHPILOT_ENV=production \
    ARCHPILOT_COOKIE_SECURE=true \
    ARCHPILOT_CORS_ORIGINS= \
    ARCHPILOT_DB_PATH=/data/archpilot.db \
    ARCHPILOT_BACKUP_DIR=/data/backups

WORKDIR /srv
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/scripts ./scripts
# Task 1.6: app/contract.py validates design bodies against this file at request
# time and refuses to start without it (it looks in /srv/contracts first).
COPY contracts/archgraph.schema.json ./contracts/archgraph.schema.json
COPY --from=spa /spa/dist ./static

RUN useradd --system --uid 10001 archpilot && mkdir -p /data && chown -R archpilot /data /srv
USER archpilot
VOLUME ["/data"]
EXPOSE 8000

# The deep probe writes to SQLite, so a locked or read-only database fails it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
