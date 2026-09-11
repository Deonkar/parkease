local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local window   = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'updated')
local tokens = tonumber(bucket[1]) or capacity
local updated = tonumber(bucket[2]) or now

tokens = math.min(capacity, tokens + (now - updated) * capacity / window)

if tokens < 1 then
  return { 0, math.ceil((1 - tokens) * window / capacity) }
end

redis.call('HSET', key, 'tokens', tokens - 1, 'updated', now)
redis.call('EXPIRE', key, window * 2)
return { 1, 0 }
