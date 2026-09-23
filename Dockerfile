# node:20 went end-of-life 2026-04-30, and the toolchain has moved past it:
# vite 8 needs ^20.19 || >=22.12 and jsdom 30 needs >=22.22.2. CI pins the same
# major (.github/workflows/ci.yml). Undo = change 24 back to 20 on this line.
FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
