# Supabase Setup Guide

## Why Supabase?

Supabase provides:
- **PostgreSQL database** - Replace Stripe metadata storage with proper tables
- **Analytics** - Track user events, page views, feature usage
- **Error logging** - Structured error storage with querying
- **Auth** - Built-in auth (optional, can complement existing auth)
- **Real-time** - Live dashboards and monitoring

## Tables to Create

### 1. `analytics_events`
```sql
CREATE TABLE analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_email TEXT,
  session_id TEXT,
  properties JSONB DEFAULT '{}',
  page_url TEXT,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_email);
CREATE INDEX idx_analytics_events_created ON analytics_events(created_at);
```

### 2. `error_logs`
```sql
CREATE TABLE error_logs (
  id BIGSERIAL PRIMARY KEY,
  error_type TEXT NOT NULL,
  error_message TEXT,
  stack_trace TEXT,
  endpoint TEXT,
  user_email TEXT,
  request_body JSONB,
  status_code INTEGER,
  severity TEXT DEFAULT 'error',
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_error_logs_type ON error_logs(error_type);
CREATE INDEX idx_error_logs_severity ON error_logs(severity);
CREATE INDEX idx_error_logs_created ON error_logs(created_at);
```

### 3. `analysis_results`
```sql
CREATE TABLE analysis_results (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  plan TEXT NOT NULL,
  pitch_hash TEXT,
  word_count INTEGER,
  score INTEGER,
  label TEXT,
  sections JSONB,
  recommendations JSONB,
  red_flags JSONB,
  model_used TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_user ON analysis_results(user_email);
CREATE INDEX idx_analysis_score ON analysis_results(score);
CREATE INDEX idx_analysis_created ON analysis_results(created_at);
```

### 4. `performance_metrics`
```sql
CREATE TABLE performance_metrics (
  id BIGSERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  method TEXT,
  response_time_ms INTEGER,
  status_code INTEGER,
  user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_perf_endpoint ON performance_metrics(endpoint);
CREATE INDEX idx_perf_time ON performance_metrics(response_time_ms);
```

### 5. `evaluation_results`
```sql
CREATE TABLE evaluation_results (
  id BIGSERIAL PRIMARY KEY,
  test_name TEXT NOT NULL,
  pitch_type TEXT,
  pitch_text TEXT,
  expected_score_min INTEGER,
  expected_score_max INTEGER,
  actual_score INTEGER,
  passed BOOLEAN,
  model_used TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eval_passed ON evaluation_results(passed);
CREATE INDEX idx_eval_type ON evaluation_results(pitch_type);
```

## Row Level Security (RLS)

Enable RLS on all tables and create policies:

```sql
-- Only allow inserts from the service role key
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_results ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by backend API)
CREATE POLICY "Service role full access" ON analytics_events
  FOR ALL USING (auth.role() = 'service_role');
-- Repeat for all tables
```

## Environment Variables

Add to Vercel:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key (keep secret, never expose to client)
- `SUPABASE_ANON_KEY` - Anon/public key (safe for client-side use)