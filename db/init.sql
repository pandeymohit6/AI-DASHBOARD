CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('tenant_admin','revenue_manager','front_desk','read_only')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, id)
);
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  UNIQUE (tenant_id, id)
);
CREATE TABLE room_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id UUID NOT NULL,
  name TEXT NOT NULL,
  base_rate NUMERIC(12,2) NOT NULL CHECK (base_rate > 0),
  min_rate NUMERIC(12,2) NOT NULL CHECK (min_rate > 0),
  max_rate NUMERIC(12,2) NOT NULL CHECK (max_rate >= min_rate),
  capacity INTEGER NOT NULL DEFAULT 2 CHECK (capacity > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties(tenant_id, id) ON DELETE CASCADE
);
CREATE TABLE daily_demand (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id UUID NOT NULL,
  room_type_id UUID NOT NULL,
  stay_date DATE NOT NULL,
  rooms_available INTEGER NOT NULL CHECK (rooms_available >= 0),
  rooms_booked INTEGER NOT NULL CHECK (rooms_booked >= 0),
  pickup_7d INTEGER NOT NULL DEFAULT 0,
  local_event_score NUMERIC(4,3) NOT NULL DEFAULT 0 CHECK (local_event_score BETWEEN 0 AND 1),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, property_id, room_type_id, stay_date),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, room_type_id) REFERENCES room_types(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX daily_demand_tenant_date_idx ON daily_demand(tenant_id, property_id, stay_date);
CREATE INDEX daily_demand_room_date_idx ON daily_demand(tenant_id, room_type_id, stay_date);

CREATE TABLE rate_suggestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id UUID NOT NULL,
  requested_by UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  provider TEXT,
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, requested_by) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  CHECK (end_date >= start_date),
  CHECK (end_date <= start_date + 90)
);
CREATE INDEX rate_jobs_tenant_created_idx ON rate_suggestion_jobs(tenant_id, created_at DESC);
CREATE INDEX rate_jobs_queue_idx ON rate_suggestion_jobs(status, created_at) WHERE status = 'queued';

-- Demo tenant and user. Password hash below is bcrypt for DemoPass!234.
INSERT INTO tenants (id, name) VALUES ('11111111-1111-4111-8111-111111111111','Demo Hospitality Group');
INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','revenue@demo.staywise.local','$2b$10$0XLPJz4z4Rfco3zvSNPbAe0i1K/453./XZbCbL./UU6nZ0eg.DIWq','revenue_manager');
INSERT INTO properties (id, tenant_id, name, currency) VALUES
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','The Riverside Hotel','INR');
INSERT INTO room_types (id, tenant_id, property_id, name, base_rate, min_rate, max_rate, capacity) VALUES
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Deluxe King',4500,3200,8500,2),
('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Premium Twin',5200,3800,9800,2);
INSERT INTO daily_demand (tenant_id, property_id, room_type_id, stay_date, rooms_available, rooms_booked, pickup_7d, local_event_score)
SELECT '11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',r.id,
       CURRENT_DATE + d.day_no, 40, (12 + (d.day_no * 3) % 26), (d.day_no % 7) + 1, ((d.day_no % 4)::numeric / 4)
FROM room_types r CROSS JOIN generate_series(1,21) AS d(day_no)
WHERE r.tenant_id='11111111-1111-4111-8111-111111111111';
