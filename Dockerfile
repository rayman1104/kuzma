FROM oven/bun:1 AS install

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1

WORKDIR /app
COPY --from=install /app/node_modules node_modules
COPY package.json bun.lock ./
COPY src src

# Claude CLI must be available in PATH
# Mount or install it in your deployment

RUN mkdir -p data

EXPOSE 3847
CMD ["bun", "run", "src/index.ts"]
