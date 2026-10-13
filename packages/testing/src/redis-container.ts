import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

/**
 * A real Redis, for the code a fake cannot exercise: the rate limiter's token bucket is a Lua
 * script (S-153). Returns the URL; the caller owns its client.
 */
export async function startRedisContainer(): Promise<{
  container: StartedTestContainer;
  url: string;
}> {
  const container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  return {
    container,
    url: `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`,
  };
}
