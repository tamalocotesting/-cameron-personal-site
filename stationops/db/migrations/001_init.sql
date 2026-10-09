-- StationOps initial schema.
--
-- Design rules this schema enforces:
--  * Templates are versioned. A version and its tasks are never updated after
--    they are written; editing a template writes a new version.
--  * A checklist run copies its tasks into run_items when it starts, so a run
--    always shows the exact wording and "required" flags the employee saw,
--    whatever happens to the template later.
--  * One run per station, shift type and shift date (the duplicate guard).
--  * All timestamps are timestamptz (stored in UTC). shift_date is the
--    restaurant's local calendar date, computed from restaurants.timezone.

create table restaurants (
  id          serial primary key,
  name        text not null,
  timezone    text not null,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table stations (
  id             serial primary key,
  restaurant_id  integer not null references restaurants(id),
  name           text not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table users (
  id             serial primary key,
  restaurant_id  integer not null references restaurants(id),
  username       text not null,
  display_name   text not null,
  role           text not null check (role in ('employee', 'manager')),
  station_id     integer references stations(id),
  password_hash  text not null,
  active         boolean not null default true,
  failed_logins  integer not null default 0,
  locked_until   timestamptz,
  created_at     timestamptz not null default now()
);
create unique index users_username_lower on users (lower(username));

create table sessions (
  token_hash  text primary key,
  user_id     integer not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index sessions_user on sessions (user_id);

create table checklist_templates (
  id                  serial primary key,
  restaurant_id       integer not null references restaurants(id),
  station_id          integer not null references stations(id),
  name                text not null,
  shift_type          text not null default 'opening',
  active              boolean not null default true,
  current_version_id  integer,
  created_at          timestamptz not null default now(),
  unique (station_id, shift_type)
);

create table template_versions (
  id              serial primary key,
  template_id     integer not null references checklist_templates(id),
  version_number  integer not null,
  name            text not null,
  change_note     text,
  created_by      integer references users(id),
  created_at      timestamptz not null default now(),
  unique (template_id, version_number)
);

alter table checklist_templates
  add constraint checklist_templates_current_version_fk
  foreign key (current_version_id) references template_versions(id);

create table template_tasks (
  id           serial primary key,
  version_id   integer not null references template_versions(id),
  position     integer not null,
  description  text not null,
  required     boolean not null default true,
  unique (version_id, position)
);

create table checklist_runs (
  id                   serial primary key,
  restaurant_id        integer not null references restaurants(id),
  station_id           integer not null references stations(id),
  template_id          integer not null references checklist_templates(id),
  template_version_id  integer not null references template_versions(id),
  checklist_name       text not null,
  shift_type           text not null,
  shift_date           date not null,
  status               text not null default 'in_progress'
                         check (status in ('in_progress', 'submitted')),
  outcome              text check (outcome in ('complete', 'exceptions')),
  started_by           integer not null references users(id),
  started_at           timestamptz not null default now(),
  submitted_by         integer references users(id),
  submitted_at         timestamptz,
  is_sample            boolean not null default false,
  unique (station_id, shift_type, shift_date),
  check ((status = 'submitted') = (submitted_at is not null)),
  check ((status = 'submitted') = (outcome is not null))
);
create index checklist_runs_date on checklist_runs (restaurant_id, shift_date desc);

create table run_items (
  id                serial primary key,
  run_id            integer not null references checklist_runs(id) on delete cascade,
  template_task_id  integer references template_tasks(id),
  position          integer not null,
  description       text not null,
  required          boolean not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'done', 'blocked')),
  note              text,
  completed_at      timestamptz,
  completed_by      integer references users(id),
  flagged_at        timestamptz,
  flagged_by        integer references users(id),
  updated_at        timestamptz,
  updated_by        integer references users(id),
  unique (run_id, position)
);

create table issues (
  id             serial primary key,
  restaurant_id  integer not null references restaurants(id),
  run_id         integer not null references checklist_runs(id) on delete cascade,
  run_item_id    integer not null references run_items(id) on delete cascade,
  description    text not null,
  status         text not null default 'open'
                   check (status in ('open', 'resolved', 'withdrawn')),
  reported_by    integer not null references users(id),
  reported_at    timestamptz not null default now(),
  resolution     text,
  resolved_by    integer references users(id),
  resolved_at    timestamptz
);
-- At most one open issue per checklist task.
create unique index issues_one_open_per_item on issues (run_item_id) where status = 'open';
create index issues_status on issues (restaurant_id, status);

-- Pilot measurement. expected_runs comes from the real shift schedule or a
-- manager's count; it is never inferred.
create table measurement_periods (
  id                     serial primary key,
  restaurant_id          integer not null references restaurants(id),
  label                  text not null,
  kind                   text not null check (kind in ('baseline', 'pilot')),
  start_date             date not null,
  end_date               date not null,
  expected_runs          integer not null check (expected_runs > 0),
  manual_completed_runs  integer check (manual_completed_runs >= 0),
  notes                  text,
  created_by             integer references users(id),
  created_at             timestamptz not null default now(),
  check (end_date >= start_date)
);

-- The app connects as the table owner, which bypasses row level security.
-- Enabling RLS with no policies means that if this database is hosted on
-- Supabase, its public REST API (anon / authenticated roles) can read nothing.
alter table restaurants         enable row level security;
alter table stations            enable row level security;
alter table users               enable row level security;
alter table sessions            enable row level security;
alter table checklist_templates enable row level security;
alter table template_versions   enable row level security;
alter table template_tasks      enable row level security;
alter table checklist_runs      enable row level security;
alter table run_items           enable row level security;
alter table issues              enable row level security;
alter table measurement_periods enable row level security;
