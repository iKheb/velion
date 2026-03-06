-- Minimal seed for demo/testing (safe to run repeatedly)
-- Note: profiles are linked to auth.users, so this seed only uses existing users.

insert into public.posts (author_id, content, created_at)
select p.id, 'Post demo para smoke de feed', now()
from public.profiles p
where not exists (
  select 1
  from public.posts x
  where x.author_id = p.id
    and x.content = 'Post demo para smoke de feed'
)
limit 1;
