-- Anonymous users for now; accounts will add columns (email, password hash) here.
create table users (
    id         uuid primary key,
    created_at timestamptz not null
);

create table sets (
    id         uuid primary key,
    owner_id   uuid not null references users (id) on delete cascade,
    name       text not null,
    width      int not null,
    depth      int not null,
    updated_at timestamptz not null,
    -- The .setbuilder zip exactly as the web app wrote it.
    file       bytea not null
);

create index sets_owner_updated on sets (owner_id, updated_at desc);
